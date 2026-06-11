package main

import (
	"context"
	"errors"
	"fmt"
	"log"
	"sync"
	"time"

	"copytextcompanion/internal/companion"

	wailsruntime "github.com/wailsapp/wails/v2/pkg/runtime"
)

type App struct {
	service *companion.Service

	ctx       context.Context
	ctxMu     sync.Mutex
	stopWatch chan struct{}
	hotkey    *hotkeyManager
	tray      *trayManager

	clipboardMu       sync.Mutex
	selfClipboardText string
}

func NewApp(service *companion.Service) *App {
	return &App{
		service:   service,
		stopWatch: make(chan struct{}),
	}
}

func (app *App) startup(ctx context.Context) {
	app.ctxMu.Lock()
	app.ctx = ctx
	app.ctxMu.Unlock()

	app.service.SetOpenAppHandler(func() bool {
		return app.OpenApp()
	})

	app.hotkey = newHotkeyManager(func() {
		app.OpenApp()
	})
	if settings, err := app.service.GetSettings(); err == nil {
		if err := app.hotkey.Update(settings.Hotkey); err != nil {
			log.Printf("register global hotkey: %v", err)
		}
	}
	app.tray = newTrayManager(trayActions{
		Show:     app.OpenApp,
		Minimize: app.HideApp,
		Quit:     app.Quit,
	})
	if err := app.tray.Start(); err != nil {
		log.Printf("start tray icon: %v", err)
	}
	go app.watchClipboard()
}

func (app *App) shutdown(ctx context.Context) {
	select {
	case <-app.stopWatch:
	default:
		close(app.stopWatch)
	}
	if app.hotkey != nil {
		app.hotkey.Stop()
	}
	if app.tray != nil {
		app.tray.Stop()
	}
}

func (app *App) ListHistory(query string) ([]companion.HistoryEntry, error) {
	return app.service.ListHistory(companion.ListHistoryOptions{Query: query, Limit: 250})
}

func (app *App) DeleteHistory(id string) (bool, error) {
	return app.service.DeleteHistory(id)
}

func (app *App) ClearHistory() (int, error) {
	return app.service.ClearHistory()
}

func (app *App) PinHistory(id string, pinned bool) (bool, error) {
	return app.service.PinHistory(id, pinned)
}

func (app *App) CopyText(text string) error {
	ctx := app.context()
	if ctx == nil {
		return errors.New("app context is unavailable")
	}
	if err := wailsruntime.ClipboardSetText(ctx, text); err != nil {
		return err
	}
	app.markSelfClipboardText(text)
	return nil
}

func (app *App) FormatPreview(text string, action string) companion.FormatPreviewResult {
	return app.service.FormatPreview(text, action)
}

func (app *App) GetSettings() (companion.Settings, error) {
	return app.service.GetSettings()
}

func (app *App) UpdateSettings(patch companion.SettingsPatch) (companion.Settings, error) {
	previous, err := app.service.GetSettings()
	if err != nil {
		return companion.Settings{}, err
	}
	if patch.Hotkey != nil {
		if err := validateHotkey(*patch.Hotkey); err != nil {
			return companion.Settings{}, err
		}
	}

	settings, err := app.service.UpdateSettings(patch)
	if err != nil {
		return companion.Settings{}, err
	}
	if patch.AutoStart != nil {
		if err := configureAutoStart(settings.AutoStart); err != nil {
			return companion.Settings{}, errors.Join(err, app.restoreSettings(previous, true, false))
		}
	}
	if patch.Hotkey != nil && app.hotkey != nil {
		if err := app.hotkey.Update(settings.Hotkey); err != nil {
			log.Printf("register global hotkey: %v", err)
			return settings, fmt.Errorf("settings saved, but global hotkey is not active: %w", err)
		}
	}
	return settings, nil
}

func (app *App) restoreSettings(previous companion.Settings, restoreAutoStart bool, restoreHotkey bool) error {
	_, settingsErr := app.service.UpdateSettings(companion.SettingsPatch{
		HistoryEnabled: &previous.HistoryEnabled,
		MaxItems:       &previous.MaxItems,
		AutoStart:      &previous.AutoStart,
		Hotkey:         &previous.Hotkey,
	})

	var autoStartErr error
	if restoreAutoStart {
		autoStartErr = configureAutoStart(previous.AutoStart)
	}

	var hotkeyErr error
	if restoreHotkey && app.hotkey != nil {
		hotkeyErr = app.hotkey.Update(previous.Hotkey)
	}

	return errors.Join(settingsErr, autoStartErr, hotkeyErr)
}

func (app *App) OpenApp() bool {
	ctx := app.context()
	if ctx == nil {
		return false
	}
	wailsruntime.WindowShow(ctx)
	wailsruntime.WindowUnminimise(ctx)
	return true
}

func (app *App) HideApp() bool {
	ctx := app.context()
	if ctx == nil {
		return false
	}
	wailsruntime.WindowMinimise(ctx)
	return true
}

func (app *App) Quit() bool {
	ctx := app.context()
	if ctx == nil {
		return false
	}
	wailsruntime.Quit(ctx)
	return true
}

func (app *App) StorePath() string {
	return app.service.StorePath()
}

func (app *App) context() context.Context {
	app.ctxMu.Lock()
	defer app.ctxMu.Unlock()
	return app.ctx
}

func (app *App) watchClipboard() {
	ticker := time.NewTicker(1400 * time.Millisecond)
	defer ticker.Stop()

	var lastText string
	for {
		select {
		case <-app.stopWatch:
			return
		case <-ticker.C:
			ctx := app.context()
			if ctx == nil {
				continue
			}
			text, err := wailsruntime.ClipboardGetText(ctx)
			if err != nil || text == "" || text == lastText {
				continue
			}
			settings, err := app.service.GetSettings()
			if err != nil {
				log.Printf("read companion settings: %v", err)
				continue
			}
			if !settings.HistoryEnabled {
				lastText = text
				continue
			}
			if app.consumeSelfClipboardText(text) {
				lastText = text
				continue
			}
			_, err = app.service.RecordClipboardEvent(companion.ClipboardEvent{
				Source:    "desktop-clipboard",
				Mode:      "copy",
				Text:      text,
				CreatedAt: time.Now().UnixMilli(),
			})
			if err != nil {
				log.Printf("record clipboard history: %v", err)
				continue
			} else {
				lastText = text
			}
		}
	}
}

func (app *App) markSelfClipboardText(text string) {
	app.clipboardMu.Lock()
	defer app.clipboardMu.Unlock()
	app.selfClipboardText = text
}

func (app *App) consumeSelfClipboardText(text string) bool {
	app.clipboardMu.Lock()
	defer app.clipboardMu.Unlock()
	if app.selfClipboardText != text {
		return false
	}
	app.selfClipboardText = ""
	return true
}
