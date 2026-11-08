package main

import (
	"syscall"
	"unsafe"
)

const (
	buttonControl = 101
	buttonCopyOBS = 102
	buttonExit    = 103
	buttonChoose  = 104
	buttonTosu    = 105

	msgServiceStarted = 0x8001
	msgServiceStopped = 0x8002
	msgTosuExited     = 0x8003
	msgTosuChecked    = 0x8004
	tosuTimer         = 1

	launcherWidth  = 640
	launcherHeight = 430
)

type rect struct{ Left, Top, Right, Bottom int32 }

type drawItem struct {
	ControlType, ControlID, ItemID, Action, State uint32
	Item, DC                                      uintptr
	Bounds                                        rect
	Data                                          uintptr
}

type color uint32

func rgb(r, g, b uint32) color { return color(r | g<<8 | b<<16) }

var (
	canvasColor = rgb(242, 240, 248)
	headerColor = rgb(29, 20, 48)
	cardColor   = rgb(255, 255, 255)
	inkColor    = rgb(36, 25, 55)
	mutedColor  = rgb(95, 83, 115)
	accentColor = rgb(108, 64, 190)
	waitColor   = rgb(128, 87, 17)
	readyColor  = rgb(26, 108, 81)
)

type textColors struct{ foreground, background color }

var (
	windowScale                            = 96
	brushes                                = map[color]uintptr{}
	controlColors                          = map[uintptr]textColors{}
	serviceStatus, tosuField, tosuFeedback uintptr
	tosuProcessStatus, tosuPortStatus      uintptr
)

func px(n int) uintptr { return uintptr((n*windowScale + 48) / 96) }

func brush(c color) uintptr {
	if brushes[c] == 0 {
		brushes[c] = call(gdi, "CreateSolidBrush", uintptr(c))
	}
	return brushes[c]
}

func area(x, y, width, height int) rect {
	return rect{int32(px(x)), int32(px(y)), int32(px(x + width)), int32(px(y + height))}
}

func fill(dc uintptr, bounds rect, c color) {
	call(user, "FillRect", dc, uintptr(unsafe.Pointer(&bounds)), brush(c))
}

func paintLauncher(dc uintptr) {
	fill(dc, area(0, 0, launcherWidth, launcherHeight), canvasColor)
	fill(dc, area(0, 0, launcherWidth, 70), headerColor)
	fill(dc, area(0, 70, launcherWidth, 3), accentColor)
	fill(dc, area(24, 87, 592, 136), cardColor)
	fill(dc, area(24, 237, 592, 173), cardColor)
}

func paintStatic(dc, child uintptr) uintptr {
	palette, ok := controlColors[child]
	if !ok {
		return 0
	}
	call(gdi, "SetTextColor", dc, uintptr(palette.foreground))
	call(gdi, "SetBkColor", dc, uintptr(palette.background))
	return brush(palette.background)
}

func paintButton(item *drawItem) bool {
	if item.ControlType != 4 { // ODT_BUTTON
		return false
	}
	background, pressed, foreground := rgb(234, 228, 247), rgb(216, 205, 241), inkColor
	switch item.ControlID {
	case buttonControl, buttonTosu:
		background, pressed, foreground = accentColor, rgb(82, 42, 154), cardColor
	case buttonExit:
		background, pressed, foreground = rgb(249, 235, 240), rgb(241, 214, 225), rgb(128, 39, 72)
	}
	if item.State&0x0001 != 0 { // ODS_SELECTED
		background = pressed
	}
	if item.State&0x0004 != 0 { // ODS_DISABLED
		background, foreground = rgb(239, 236, 244), mutedColor
	}
	fill(item.DC, item.Bounds, background)
	var caption [128]uint16
	call(user, "GetWindowTextW", item.Item, uintptr(unsafe.Pointer(&caption[0])), uintptr(len(caption)))
	font := call(user, "SendMessageW", item.Item, 0x31, 0, 0) // WM_GETFONT
	oldFont := call(gdi, "SelectObject", item.DC, font)
	call(gdi, "SetBkMode", item.DC, 1) // TRANSPARENT
	call(gdi, "SetTextColor", item.DC, uintptr(foreground))
	bounds := item.Bounds
	call(user, "DrawTextW", item.DC, uintptr(unsafe.Pointer(&caption[0])), ^uintptr(0), uintptr(unsafe.Pointer(&bounds)), 0x25) // Center, vertically centered, single line.
	call(gdi, "SelectObject", item.DC, oldFont)
	if item.State&0x0010 != 0 && item.State&0x0200 == 0 { // ODS_FOCUS, ODS_NOFOCUSRECT
		margin := int32(px(4))
		bounds = rect{bounds.Left + margin, bounds.Top + margin, bounds.Right - margin, bounds.Bottom - margin}
		call(user, "DrawFocusRect", item.DC, uintptr(unsafe.Pointer(&bounds)))
	}
	return true
}

func setText(control uintptr, value string) {
	call(user, "SetWindowTextW", control, ptr(value))
}

func showTosu(note string) {
	path := tosuPath
	if path == "" {
		path = "尚未选择 tosu.exe"
	}
	setText(tosuField, path)
	setText(tosuFeedback, note)
}

func showTosuProcess(status tosuProcess) {
	label, fg := "正在检查…", mutedColor
	switch status {
	case tosuMissing:
		label = "未选有效文件"
	case tosuStopped:
		label = "未运行"
	case tosuRunning:
		label, fg = "运行中", readyColor
	case tosuUnknown:
		label, fg = "无法确认", waitColor
	}
	setStatus(tosuProcessStatus, "所选程序 · "+label, fg)
	var enabled uintptr
	if status == tosuStopped {
		enabled = 1
	}
	call(user, "EnableWindow", call(user, "GetDlgItem", window, buttonTosu), enabled)
}

func showTosuPort(open bool) {
	label, fg := "未连通", mutedColor
	if open {
		label, fg = "可连通", readyColor
	}
	setStatus(tosuPortStatus, "端口 "+tosuAddress+" · "+label, fg)
}

func setStatus(control uintptr, text string, foreground color) {
	controlColors[control] = textColors{foreground, cardColor}
	setText(control, text)
}

func launcherFont(size, weight int) uintptr {
	return call(gdi, "CreateFontW", 0-px(size), 0, 0, 0, uintptr(weight), 0, 0, 0, 1, 0, 0, 5, 0, ptr("Segoe UI"))
}

func runWindow() {
	call(user, "SetProcessDPIAware")
	dc := call(user, "GetDC", 0)
	if dc != 0 {
		if dpi := call(gdi, "GetDeviceCaps", dc, 88); dpi > 0 { // LOGPIXELSX
			windowScale = int(dpi)
		}
		call(user, "ReleaseDC", 0, dc)
	}
	instance := call(kernel, "GetModuleHandleW", 0)
	class := wc{Proc: syscall.NewCallback(wndProc), Instance: instance, Cursor: call(user, "LoadCursorW", 0, 32512),
		Name: syscall.StringToUTF16Ptr("OCLRPortableWindow")}
	class.Size = uint32(unsafe.Sizeof(class))
	if call(user, "RegisterClassExW", uintptr(unsafe.Pointer(&class))) == 0 {
		message("无法创建启动窗口。")
		return
	}
	const windowStyle = 0x00CA0000
	bounds := area(0, 0, launcherWidth, launcherHeight)
	call(user, "AdjustWindowRectEx", uintptr(unsafe.Pointer(&bounds)), windowStyle, 0, 0)
	window = call(user, "CreateWindowExW", 0, ptr("OCLRPortableWindow"), ptr("OCLR 直播服务"), windowStyle,
		0x80000000, 0x80000000, uintptr(bounds.Right-bounds.Left), uintptr(bounds.Bottom-bounds.Top), 0, 0, instance, 0)
	if window == 0 {
		message("无法创建启动窗口。")
		return
	}
	titleFont, headingFont, bodyFont, captionFont := launcherFont(24, 600), launcherFont(16, 600), launcherFont(14, 400), launcherFont(12, 400)
	defer func() {
		for _, font := range []uintptr{titleFont, headingFont, bodyFont, captionFont} {
			call(gdi, "DeleteObject", font)
		}
		for _, handle := range brushes {
			call(gdi, "DeleteObject", handle)
		}
	}()
	add := func(kind, title string, x, y, width, height int, id, style, font uintptr) uintptr {
		h := call(user, "CreateWindowExW", 0, ptr(kind), ptr(title), 0x50000000|style,
			px(x), px(y), px(width), px(height), window, id, instance, 0)
		call(user, "SendMessageW", h, 0x30, font, 1) // WM_SETFONT
		return h
	}
	static := func(value string, x, y, width, height int, font uintptr, fg, bg color) uintptr {
		h := add("STATIC", value, x, y, width, height, 0, 0, font)
		controlColors[h] = textColors{fg, bg}
		return h
	}
	button := func(value string, x, y, width int, id uintptr) uintptr {
		return add("BUTTON", value, x, y, width, 36, id, 0x1000B, bodyFont) // WS_TABSTOP | BS_OWNERDRAW
	}
	static("OCLR 直播服务", 24, 12, 590, 30, titleFont, cardColor, headerColor)
	static("直播控制台与 OBS 浏览器源", 25, 47, 589, 18, captionFont, rgb(214, 199, 242), headerColor)
	static("直播服务", 42, 97, 200, 24, headingFont, inkColor, cardColor)
	serviceStatus = static("● 正在启动", 440, 100, 156, 21, bodyFont, waitColor, cardColor)
	static("OBS 地址  "+base+"/overlay", 42, 127, 554, 20, bodyFont, mutedColor, cardColor)
	call(user, "EnableWindow", button("打开控制台", 42, 152, 172, buttonControl), 0)
	call(user, "EnableWindow", button("复制 OBS 地址", 234, 152, 172, buttonCopyOBS), 0)
	button("退出直播服务", 426, 152, 172, buttonExit)
	label = static("正在准备本机服务，请稍候…", 42, 198, 554, 19, captionFont, mutedColor, cardColor)
	static("tosu 应用程序", 42, 247, 555, 22, headingFont, inkColor, cardColor)
	tosuField = add("EDIT", "", 42, 274, 556, 25, 106, 0x810880, bodyFont) // Border, tab stop, read-only, horizontal scroll.
	controlColors[tosuField] = textColors{inkColor, cardColor}
	button("选择 tosu…", 42, 317, 148, buttonChoose)
	button("打开 tosu", 202, 317, 148, buttonTosu)
	tosuFeedback = static("", 364, 326, 234, 22, captionFont, mutedColor, cardColor)
	tosuProcessStatus = static("", 42, 369, 229, 23, bodyFont, mutedColor, cardColor)
	tosuPortStatus = static("端口 "+tosuAddress+" · 正在检查…", 287, 369, 311, 23, bodyFont, mutedColor, cardColor)
	loadTosuPreference()
	showTosuProcess(tosuChecking)
	checkTosu(window)
	call(user, "SetTimer", window, tosuTimer, 2000, 0)
	call(user, "ShowWindow", window, 1)
	call(user, "UpdateWindow", window)
	go func() {
		b, e := start()
		result <- started{b, e}
		call(user, "PostMessageW", window, msgServiceStarted, 0, 0)
	}()
	var m msg
	for int32(call(user, "GetMessageW", uintptr(unsafe.Pointer(&m)), 0, 0, 0)) > 0 {
		if call(user, "IsDialogMessageW", window, uintptr(unsafe.Pointer(&m))) == 0 {
			call(user, "TranslateMessage", uintptr(unsafe.Pointer(&m)))
			call(user, "DispatchMessageW", uintptr(unsafe.Pointer(&m)))
		}
	}
	// On launcher crash/exit the child's stdin closes; the backend drains and stops.
}
