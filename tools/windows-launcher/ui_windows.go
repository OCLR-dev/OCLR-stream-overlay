package main

import (
	"errors"
	"os"
	"syscall"
	"unsafe"
)

const (
	buttonCopyAddresses   = 114
	buttonRestart         = 112
	buttonControl         = 101
	buttonCopyOBS         = 102
	buttonExit            = 103
	buttonChoose          = 104
	buttonTosu            = 105
	buttonOpenLog         = 107
	buttonChooseOsu       = 108
	buttonGenerateTourney = 109
	buttonOpenTourney     = 110
	buttonOverview        = 115
	buttonSettings        = 116
	buttonLogs            = 117
	buttonAbout           = 118
	buttonProject         = 119
	editServicePort       = 113
	editLogPreview        = 120

	msgServiceStarted  = 0x8001
	msgServiceState    = 0x8002
	msgTosuExited      = 0x8003
	msgTosuChecked     = 0x8004
	msgTourneyFinished = 0x8005
	tosuTimer          = 1

	launcherWidth  = 780
	launcherHeight = 500
	sidebarWidth   = 152
	pageLeft       = 176
	pageWidth      = launcherWidth - pageLeft - 24
)

type launcherPage int

const (
	pageOverview launcherPage = iota
	pageSettings
	pageLogs
	pageAbout
	pageCount
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
	canvasColor = rgb(246, 243, 250)
	railColor   = rgb(238, 232, 246)
	lineColor   = rgb(228, 220, 237)
	activeColor = rgb(228, 216, 245)
	cardColor   = rgb(255, 255, 255)
	inkColor    = rgb(36, 25, 55)
	mutedColor  = rgb(95, 83, 115)
	accentColor = rgb(108, 64, 190)
	waitColor   = rgb(128, 87, 17)
	readyColor  = rgb(26, 108, 81)
	errorColor  = rgb(128, 39, 72)
)

type textColors struct{ foreground, background color }

var (
	windowScale                            = 96
	brushes                                = map[color]uintptr{}
	controlColors                          = map[uintptr]textColors{}
	serviceStatus, tosuField, tosuFeedback uintptr
	tosuProcessStatus, tosuPortStatus      uintptr
	osuField, tourneyFeedback              uintptr
	tosuSettingsFeedback                   uintptr
	tourneySettingsFeedback                uintptr
	settingsStatus, logPreview             uintptr
	logPreviewText                         string
	pageControls                           [pageCount][]uintptr
	currentPage                            launcherPage
	navIconFont                            uintptr
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
	fill(dc, area(0, 0, sidebarWidth, launcherHeight), railColor)
	fill(dc, area(sidebarWidth-1, 0, 1, launcherHeight), lineColor)
	fill(dc, area(12, 438, sidebarWidth-24, 1), lineColor)
	switch currentPage {
	case pageOverview:
		paintCard(dc, 87, 155)
		paintCard(dc, 256, 166)
		fill(dc, area(pageLeft+pageWidth/2, 274, 1, 130), lineColor)
	case pageSettings:
		paintCard(dc, 87, 148)
		paintCard(dc, 248, 236)
	case pageLogs:
		paintCard(dc, 87, 383)
	case pageAbout:
		paintCard(dc, 87, 158)
	}
}

func paintCard(dc uintptr, y, height int) {
	bounds := area(pageLeft, y, pageWidth, height)
	oldBrush := call(gdi, "SelectObject", dc, brush(cardColor))
	oldPen := call(gdi, "SelectObject", dc, call(gdi, "GetStockObject", 8)) // NULL_PEN
	call(gdi, "RoundRect", dc, uintptr(bounds.Left), uintptr(bounds.Top), uintptr(bounds.Right), uintptr(bounds.Bottom), px(14), px(14))
	call(gdi, "SelectObject", dc, oldPen)
	call(gdi, "SelectObject", dc, oldBrush)
}

func showLauncherPage(page launcherPage) {
	for _, control := range pageControls[currentPage] {
		call(user, "ShowWindow", control, 0) // SW_HIDE
	}
	currentPage = page
	for _, control := range pageControls[page] {
		call(user, "ShowWindow", control, 8) // SW_SHOWNA
	}
	if page == pageLogs {
		refreshLogPreview()
	}
	call(user, "RedrawWindow", window, 0, 0, 0x0085) // RDW_INVALIDATE | RDW_ERASE | RDW_ALLCHILDREN
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
	var icon string
	switch item.ControlID {
	case buttonControl, buttonRestart:
		background, pressed, foreground = accentColor, rgb(82, 42, 154), cardColor
	case buttonOverview, buttonSettings, buttonLogs, buttonAbout:
		icons := [...]string{"\uE80F", "\uE713", "\uE8A5", "\uE946"}
		page := launcherPage(item.ControlID - buttonOverview)
		icon = icons[page]
		background, pressed, foreground = railColor, activeColor, mutedColor
		if page == currentPage {
			background, foreground = activeColor, accentColor
		}
	case buttonExit:
		icon = "\uE7E8"
		background, pressed, foreground = railColor, rgb(241, 214, 225), errorColor
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
	format := uintptr(0x25) // DT_CENTER | DT_VCENTER | DT_SINGLELINE
	if icon != "" {
		call(gdi, "SelectObject", item.DC, navIconFont)
		bounds.Left += int32(px(11))
		call(user, "DrawTextW", item.DC, ptr(icon), ^uintptr(0), uintptr(unsafe.Pointer(&bounds)), 0x24)
		call(gdi, "SelectObject", item.DC, font)
		bounds.Left += int32(px(24))
		format = 0x24 // Left aligned navigation label.
	}
	call(user, "DrawTextW", item.DC, uintptr(unsafe.Pointer(&caption[0])), ^uintptr(0), uintptr(unsafe.Pointer(&bounds)), format)
	call(gdi, "SelectObject", item.DC, oldFont)
	if item.State&0x0010 != 0 && item.State&0x0200 == 0 { // ODS_FOCUS, ODS_NOFOCUSRECT
		bounds := item.Bounds
		if icon != "" {
			// Sidebar buttons use a focus mark beside the icon, separate from the active page highlight.
			fill(item.DC, rect{bounds.Left + int32(px(4)), bounds.Top + int32(px(9)),
				bounds.Left + int32(px(6)), bounds.Bottom - int32(px(9))}, foreground)
			return true
		}
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
	setText(tosuSettingsFeedback, note)
}

func showTourney(note string) {
	path := osuPath
	if path == "" {
		path = "尚未选择 osu!.exe"
	}
	if note == "" {
		switch {
		case osuPath == "":
			note = "到「设置」选择 osu!stable 的 osu!.exe。"
		case !isOsuExecutable(osuPath):
			note = "找不到保存的文件，请重新选择。"
		default:
			note = "请先在直播控制台连接授权赛季。"
		}
	}
	setText(osuField, path)
	setText(tourneyFeedback, note)
	setText(tourneySettingsFeedback, note)
	var choose, actions uintptr
	if !tourneyBusy {
		choose = 1
		if isOsuExecutable(osuPath) {
			actions = 1
		}
	}
	call(user, "EnableWindow", call(user, "GetDlgItem", window, buttonChooseOsu), choose)
	for _, id := range []uintptr{buttonGenerateTourney, buttonOpenTourney} {
		call(user, "EnableWindow", call(user, "GetDlgItem", window, id), actions)
	}
}

func showTosuProcess(status processStatus) {
	label, fg := "正在检查…", mutedColor
	switch status {
	case processMissing:
		label = "未选有效文件"
	case processStopped:
		label = "未运行"
	case processRunning:
		label, fg = "运行中", readyColor
	case processUnknown:
		label, fg = "无法确认", waitColor
	}
	setStatus(tosuProcessStatus, "所选程序 · "+label, fg)
	var enabled uintptr
	if status == processStopped {
		enabled = 1
	}
	call(user, "EnableWindow", call(user, "GetDlgItem", window, buttonTosu), enabled)
}

func showTosuPort(probe tosuProbe) {
	switch {
	case probe.portOpen:
		setStatus(tosuPortStatus, "端口 "+probe.address()+" · 可连通", readyColor)
	case probe.port != "":
		setStatus(tosuPortStatus, "端口 "+probe.address()+" · 未连通", mutedColor)
	case errors.Is(probe.portErr, os.ErrNotExist):
		setStatus(tosuPortStatus, "端口 · 未找到 tosu.env", waitColor)
	case errors.Is(probe.portErr, errTosuPortMissing):
		setStatus(tosuPortStatus, "端口 · tosu.env 未设置 SERVER_PORT", waitColor)
	case errors.Is(probe.portErr, errTosuPortInvalid):
		setStatus(tosuPortStatus, "端口 · SERVER_PORT 无效", waitColor)
	case probe.portErr != nil:
		setStatus(tosuPortStatus, "端口 · 无法读取 tosu.env", waitColor)
	default:
		setStatus(tosuPortStatus, "端口 · 请先选择 tosu", mutedColor)
	}
}

func setStatus(control uintptr, text string, foreground color) {
	controlColors[control] = textColors{foreground, cardColor}
	setText(control, text)
}

func launcherFont(size, weight int, face string) uintptr {
	return call(gdi, "CreateFontW", 0-px(size), 0, 0, 0, uintptr(weight), 0, 0, 0, 1, 0, 0, 5, 0, ptr(face))
}

func createLauncherWindow() func() {
	call(user, "SetProcessDPIAware")
	dc := call(user, "GetDC", 0)
	if dc != 0 {
		if dpi := call(gdi, "GetDeviceCaps", dc, 88); dpi > 0 { // LOGPIXELSX
			windowScale = int(dpi)
		}
		call(user, "ReleaseDC", 0, dc)
	}
	instance := call(kernel, "GetModuleHandleW", 0)
	const appIcon = 1 // ID in assets/winres.json.
	largeIcon := call(user, "LoadIconW", instance, appIcon)
	smallIcon := call(user, "LoadImageW", instance, appIcon, 1, px(16), px(16), 0) // IMAGE_ICON
	class := wc{Proc: syscall.NewCallback(wndProc), Instance: instance, Cursor: call(user, "LoadCursorW", 0, 32512),
		Icon: largeIcon, Small: smallIcon, Name: syscall.StringToUTF16Ptr("OCLRPortableWindow")}
	class.Size = uint32(unsafe.Sizeof(class))
	if call(user, "RegisterClassExW", uintptr(unsafe.Pointer(&class))) == 0 {
		if smallIcon != 0 {
			call(user, "DestroyIcon", smallIcon)
		}
		message("无法创建启动窗口。")
		return nil
	}
	const windowStyle = 0x02CA0000 // Includes WS_CLIPCHILDREN for switching pages.
	bounds := area(0, 0, launcherWidth, launcherHeight)
	call(user, "AdjustWindowRectEx", uintptr(unsafe.Pointer(&bounds)), windowStyle, 0, 0)
	window = call(user, "CreateWindowExW", 0, ptr("OCLRPortableWindow"), ptr("OCLR 直播服务"), windowStyle,
		0x80000000, 0x80000000, uintptr(bounds.Right-bounds.Left), uintptr(bounds.Bottom-bounds.Top), 0, 0, instance, 0)
	if window == 0 {
		call(user, "UnregisterClassW", ptr("OCLRPortableWindow"), instance)
		if smallIcon != 0 {
			call(user, "DestroyIcon", smallIcon)
		}
		message("无法创建启动窗口。")
		return nil
	}
	titleFont := launcherFont(26, 600, "Segoe UI")
	headingFont := launcherFont(16, 600, "Segoe UI")
	bodyFont := launcherFont(14, 400, "Segoe UI")
	captionFont := launcherFont(12, 400, "Segoe UI")
	logFont := launcherFont(13, 400, "Consolas")
	navIconFont = launcherFont(15, 400, "Segoe MDL2 Assets")
	cleanup := func() {
		for _, font := range []uintptr{titleFont, headingFont, bodyFont, captionFont, logFont, navIconFont} {
			call(gdi, "DeleteObject", font)
		}
		for _, handle := range brushes {
			call(gdi, "DeleteObject", handle)
		}
		clear(brushes)
		clear(controlColors)
		pageControls = [pageCount][]uintptr{}
		logPreviewText = ""
		call(user, "UnregisterClassW", ptr("OCLRPortableWindow"), instance)
		if smallIcon != 0 {
			call(user, "DestroyIcon", smallIcon)
		}
	}
	buildingPage := pageCount
	add := func(kind, title string, x, y, width, height int, id, style, font uintptr) uintptr {
		const wsChild, wsVisible = 0x40000000, 0x10000000
		style |= wsChild
		if buildingPage == pageCount {
			style |= wsVisible
		}
		h := call(user, "CreateWindowExW", 0, ptr(kind), ptr(title), style,
			px(x), px(y), px(width), px(height), window, id, instance, 0)
		call(user, "SendMessageW", h, 0x30, font, 1) // WM_SETFONT
		if buildingPage < pageCount {
			pageControls[buildingPage] = append(pageControls[buildingPage], h)
		}
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
	for i, name := range [...]string{"概览", "设置", "日志", "关于"} {
		button(name, 12, 24+i*45, sidebarWidth-24, uintptr(buttonOverview+i))
	}
	button("退出直播服务", 12, 449, sidebarWidth-24, buttonExit)

	const x = pageLeft + 16
	const inside = pageWidth - 32
	const right = x + inside - 148
	heading := func(title, subtitle string) {
		static(title, pageLeft, 24, pageWidth, 34, titleFont, inkColor, canvasColor)
		static(subtitle, pageLeft, 60, pageWidth, 18, captionFont, mutedColor, canvasColor)
	}
	title := func(value string, x, y, width int) {
		static(value, x, y, width, 23, headingFont, inkColor, cardColor)
	}
	detail := func(value string, x, y, width, height int) uintptr {
		return static(value, x, y, width, height, captionFont, mutedColor, cardColor)
	}
	readonly := func(value string, x, y, width int, id uintptr) uintptr {
		h := add("EDIT", value, x, y, width, 30, id, 0x810880, bodyFont) // Border, tab stop, read-only, horizontal scroll.
		controlColors[h] = textColors{inkColor, canvasColor}
		return h
	}

	buildingPage = pageOverview
	heading("概览", "直播服务状态与常用操作")
	title("直播服务", x, 100, 235)
	serviceStatus = static("● 正在启动", right, 102, 148, 22, bodyFont, waitColor, cardColor)
	detail("OBS 浏览器源地址", x, 132, inside, 17)
	addressLabel = readonly(base+"/overlay", x, 153, right-x-12, 121)
	call(user, "EnableWindow", button("复制 OBS 地址", right, 150, 148, buttonCopyOBS), 0)
	call(user, "EnableWindow", button("打开控制台", x, 194, 142, buttonControl), 0)
	label = detail("正在准备本机服务，请稍候…", x+156, 195, inside-156, 40)

	otherTool := pageLeft + pageWidth/2 + 16
	toolWidth := pageWidth/2 - 32
	title("tosu", x, 271, toolWidth)
	tosuProcessStatus = detail("", x, 301, toolWidth, 17)
	tosuPortStatus = detail("端口 · 正在检查…", x, 321, toolWidth, 18)
	button("打开 tosu", x, 348, 142, buttonTosu)
	tosuFeedback = detail("", x, 391, toolWidth, 26)
	title("osu!Tourney", otherTool, 271, toolWidth)
	tourneyFeedback = detail("", otherTool, 301, toolWidth, 38)
	button("打开 osu!Tourney", otherTool, 348, 159, buttonOpenTourney)

	buildingPage = pageSettings
	heading("设置", "管理服务端口和直播工具路径")
	title("直播服务", x, 100, inside)
	detail("服务端口", x, 131, 120, 17)
	portField = add("EDIT", servicePort, x, 150, 115, 30, editServicePort, 0x810080, bodyFont)
	call(user, "EnableWindow", button("重新启动 / 重试", x+130, 147, 150, buttonRestart), 0)
	button("复制全部地址", x+292, 147, 145, buttonCopyAddresses)
	detail("端口变更在服务重启后生效。连接 OBS 后可同步画面地址。", x, 190, inside, 19)
	settingsStatus = detail("正在准备本机服务，请稍候…", x, 211, inside, 19)

	title("应用程序", x, 261, inside)
	detail("tosu 应用程序", x, 289, inside, 17)
	tosuField = readonly("", x, 309, right-x-12, 106)
	button("选择 tosu.exe…", right, 306, 148, buttonChoose)
	tosuSettingsFeedback = detail("", x, 347, inside, 18)
	detail("osu!Tourney", x, 369, inside, 17)
	osuField = readonly("", x, 389, right-x-12, 111)
	button("选择 osu!.exe…", right, 386, 148, buttonChooseOsu)
	button("生成 tournament.cfg", x, 431, 176, buttonGenerateTourney)
	tourneySettingsFeedback = detail("", x+190, 434, inside-190, 38)

	buildingPage = pageLogs
	heading("日志", "查看本机启动器与直播服务的记录")
	title("启动器日志", x, 106, 210)
	button("打开本机日志", right, 101, 148, buttonOpenLog)
	detail(`%LOCALAPPDATA%\OCLR\StreamOverlayLauncher\launcher.log`, x, 145, inside, 20)
	detail("最近记录", x, 180, inside, 18)
	logPreview = add("EDIT", "", x, 204, inside, 249, editLogPreview, 0xA10844, logFont)
	controlColors[logPreview] = textColors{inkColor, canvasColor}

	buildingPage = pageAbout
	heading("关于", "OCLR 直播服务启动器")
	title("OCLR Stream Overlay", x, 101, inside)
	detail("Windows x64 便携版 · 直播控制台与 OBS 浏览器源", x, 133, inside, 20)
	build := buildID
	if build == "" {
		build = "开发构建"
	} else if len(build) > 12 {
		build = build[:12]
	}
	detail("构建标识  "+build, x, 162, inside, 19)
	button("打开项目主页", x, 193, 148, buttonProject)

	showLauncherPage(pageOverview)
	return cleanup
}

func runWindow() {
	cleanup := createLauncherWindow()
	if cleanup == nil {
		return
	}
	defer cleanup()
	loadLauncherPreferences()
	showTosuProcess(processChecking)
	checkTosu(window)
	call(user, "SetTimer", window, tosuTimer, 2000, 0)
	call(user, "ShowWindow", window, 1)
	call(user, "UpdateWindow", window)
	go func() {
		b, e := start(localLog)
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
