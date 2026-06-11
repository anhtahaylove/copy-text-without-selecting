//go:build !windows

package main

type hotkeyManager struct{}

func newHotkeyManager(func()) *hotkeyManager {
	return &hotkeyManager{}
}

func validateHotkey(string) error {
	return nil
}

func (manager *hotkeyManager) Update(string) error {
	return nil
}

func (manager *hotkeyManager) Stop() {}
