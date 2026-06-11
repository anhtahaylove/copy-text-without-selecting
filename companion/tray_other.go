//go:build !windows

package main

type trayActions struct {
	Show     func() bool
	Minimize func() bool
	Quit     func() bool
}

type trayManager struct{}

func newTrayManager(trayActions) *trayManager {
	return &trayManager{}
}

func (manager *trayManager) Start() error {
	return nil
}

func (manager *trayManager) Stop() {}
