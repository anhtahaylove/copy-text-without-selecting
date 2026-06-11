package companion

import (
	"os"
	"os/exec"
	"strings"
	"sync"
	"time"
)

type Service struct {
	store *Store

	openMu  sync.Mutex
	openApp func() bool
}

func NewService(paths Paths) *Service {
	return &Service{
		store: NewStore(paths.StorePath),
	}
}

func (service *Service) StorePath() string {
	return service.store.Path()
}

func (service *Service) SetOpenAppHandler(handler func() bool) {
	service.openMu.Lock()
	defer service.openMu.Unlock()
	service.openApp = handler
}

func (service *Service) Ping(extensionVersion string) map[string]any {
	return map[string]any{
		"version":          ProtocolVersion,
		"host":             "copy-text-companion",
		"extensionVersion": extensionVersion,
		"capabilities": []string{
			"clipboard-event",
			"history-list",
			"history-delete",
			"history-clear",
			"history-pin",
			"format-preview",
			"settings",
			"open-app",
			"privacy",
		},
		"persistence":        "local-json",
		"maxPayload":         MaxNativeRequestBytes,
		"maxRequestBytes":    MaxNativeRequestBytes,
		"maxResponseBytes":   MaxNativeResponseBytes,
		"maxStoredTextBytes": MaxStoredTextBytes,
	}
}

func (service *Service) RecordClipboardEvent(event ClipboardEvent) (RecordResult, error) {
	text := event.Text
	if strings.TrimSpace(text) == "" {
		return RecordResult{Stored: false, Reason: "empty"}, nil
	}
	entryID := HistoryID(text)
	storedText, truncated := truncateStringBytes(text, MaxStoredTextBytes)

	settings, err := service.store.GetSettings()
	if err != nil {
		return RecordResult{}, err
	}
	if !settings.HistoryEnabled {
		return RecordResult{Stored: false, Reason: "history-disabled"}, nil
	}

	if event.CreatedAt == 0 {
		event.CreatedAt = time.Now().UnixMilli()
	}
	if event.OperationAt == 0 {
		event.OperationAt = event.CreatedAt
	}
	if event.Format == "" {
		event.Format = DetectFormat(storedText)
	}
	if event.Snippet == "" {
		event.Snippet = Snippet(storedText, 90)
	}
	if event.Source == "" {
		event.Source = "web-extension"
	}
	if event.Mode == "" {
		event.Mode = "copy"
	}

	entry, err := service.store.AddHistoryEntry(HistoryEntry{
		ID:             entryID,
		Text:           storedText,
		Snippet:        event.Snippet,
		Format:         event.Format,
		Source:         event.Source,
		Mode:           event.Mode,
		URL:            event.URL,
		Hostname:       event.Hostname,
		Title:          event.Title,
		CreatedAt:      event.CreatedAt,
		UpdatedAt:      event.OperationAt,
		SelectionBased: event.SelectionBased,
		Truncated:      event.Truncated || truncated,
	}, settings.MaxItems)
	if err != nil {
		return RecordResult{}, err
	}
	return RecordResult{Stored: true, ID: entry.ID, Truncated: entry.Truncated}, nil
}

func (service *Service) ListHistory(options ListHistoryOptions) ([]HistoryEntry, error) {
	return service.store.ListHistory(options)
}

func (service *Service) DeleteHistory(id string) (bool, error) {
	return service.store.DeleteHistoryAt(id, time.Now().UnixMilli())
}

func (service *Service) DeleteHistoryResolved(id string, text string) (bool, error) {
	return service.store.DeleteHistoryResolvedAt(id, text, time.Now().UnixMilli())
}

func (service *Service) DeleteHistoryResolvedAt(id string, text string, operationAt int64) (bool, error) {
	return service.store.DeleteHistoryResolvedAt(id, text, operationAt)
}

func (service *Service) ClearHistory() (int, error) {
	return service.store.ClearHistoryAt(time.Now().UnixMilli())
}

func (service *Service) ClearHistoryAt(operationAt int64) (int, error) {
	return service.store.ClearHistoryAt(operationAt)
}

func (service *Service) PinHistory(id string, pinned bool) (bool, error) {
	return service.store.PinHistoryAt(id, pinned, time.Now().UnixMilli())
}

func (service *Service) PinHistoryResolved(id string, text string, pinned bool) (bool, error) {
	return service.store.PinHistoryResolvedAt(id, text, pinned, time.Now().UnixMilli())
}

func (service *Service) PinHistoryResolvedAt(id string, text string, pinned bool, operationAt int64) (bool, error) {
	return service.store.PinHistoryResolvedAt(id, text, pinned, operationAt)
}

func (service *Service) FormatPreview(text string, action string) FormatPreviewResult {
	format := DetectFormat(text)
	output := text
	if action != "" {
		output = ApplyAction(text, action)
	}
	output, truncated := truncateStringBytes(output, MaxPreviewTextBytes)
	return FormatPreviewResult{
		Format:    format,
		Text:      output,
		Actions:   ActionsForFormat(format),
		Truncated: truncated,
	}
}

func (service *Service) GetSettings() (Settings, error) {
	return service.store.GetSettings()
}

func (service *Service) UpdateSettings(patch SettingsPatch) (Settings, error) {
	return service.store.UpdateSettings(patch)
}

func (service *Service) OpenApp() bool {
	service.openMu.Lock()
	handler := service.openApp
	service.openMu.Unlock()
	if handler == nil {
		executable, err := os.Executable()
		if err != nil {
			return false
		}
		return exec.Command(executable).Start() == nil
	}
	return handler()
}
