package main

import (
	"syscall"
	"unsafe"
)

func refreshLogPreview() {
	if localLog == nil {
		return
	}
	content, err := localLog.preview()
	if err != nil {
		content = "无法读取本机日志。"
	} else if content == "" {
		content = "暂无日志记录。"
	}
	if content == logPreviewText {
		return
	}
	logPreviewText = content
	type scrollInfo struct {
		size, mask    uint32
		min, max      int32
		page          uint32
		pos, trackPos int32
	}
	scroll := scrollInfo{size: uint32(unsafe.Sizeof(scrollInfo{})), mask: 7} // SIF_RANGE | SIF_PAGE | SIF_POS
	follow := call(user, "GetScrollInfo", logPreview, 1, uintptr(unsafe.Pointer(&scroll))) == 0 ||
		int64(scroll.pos)+int64(scroll.page) >= int64(scroll.max)
	// Use a temporary UTF-16 buffer so repeated log snapshots do not accumulate.
	call(user, "SetWindowTextW", logPreview, uintptr(unsafe.Pointer(syscall.StringToUTF16Ptr(content))))
	if follow {
		call(user, "SendMessageW", logPreview, 0x0115, 7, 0) // WM_VSCROLL, SB_BOTTOM
	} else if scroll.pos > 0 {
		call(user, "SendMessageW", logPreview, 0x00B6, 0, uintptr(scroll.pos)) // EM_LINESCROLL
	}
}
