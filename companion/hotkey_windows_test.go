//go:build windows

package main

import "testing"

func TestParseWindowsHotkeyAcceptsDefault(t *testing.T) {
	modifiers, key, ok := parseWindowsHotkey("Ctrl+Shift+Space")
	if !ok {
		t.Fatal("expected default hotkey to parse")
	}
	if modifiers == 0 || key == 0 {
		t.Fatalf("expected modifiers and key, got modifiers=%d key=%d", modifiers, key)
	}
}

func TestParseWindowsHotkeyAcceptsExtensionCopyShortcut(t *testing.T) {
	modifiers, key, ok := parseWindowsHotkey("Alt+Shift+C")
	if !ok {
		t.Fatal("expected extension copy shortcut hotkey to parse")
	}
	if modifiers&(modAlt|modShift|modNoRepeat) != modAlt|modShift|modNoRepeat {
		t.Fatalf("expected Alt+Shift+NoRepeat modifiers, got %d", modifiers)
	}
	if key != 'C' {
		t.Fatalf("expected C key, got %d", key)
	}
}

func TestValidateHotkeyRejectsUnsupportedValues(t *testing.T) {
	for _, value := range []string{"", "Ctrl", "Ctrl+Alt", "Ctrl+Shift+Mouse1"} {
		if err := validateHotkey(value); err == nil {
			t.Fatalf("expected %q to be rejected", value)
		}
	}
}
