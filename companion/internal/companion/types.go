package companion

import "encoding/json"

const ProtocolVersion = 1
const MaxNativeRequestBytes = 2 * 1024 * 1024
const MaxNativeResponseBytes = 1024 * 1024
const MaxNativeResponseTextBytes = 256 * 1024
const StoreSchemaVersion = 3
const DefaultHistoryLimit = 500
const MaxHistoryLimit = 9999
const MaxStoredTextBytes = 512 * 1024
const MaxPreviewTextBytes = 512 * 1024

type Envelope struct {
	ID      string          `json:"id"`
	Version int             `json:"version"`
	Type    string          `json:"type"`
	Payload json.RawMessage `json:"payload"`
}

type Response struct {
	ID      string      `json:"id"`
	OK      bool        `json:"ok"`
	Payload any         `json:"payload,omitempty"`
	Error   *ErrorShape `json:"error,omitempty"`
}

type ErrorShape struct {
	Code        string `json:"code"`
	Message     string `json:"message"`
	Recoverable bool   `json:"recoverable"`
}

type ClipboardEvent struct {
	Source         string `json:"source"`
	Mode           string `json:"mode"`
	Text           string `json:"text"`
	Snippet        string `json:"snippet"`
	Format         string `json:"format"`
	URL            string `json:"url"`
	Hostname       string `json:"hostname"`
	Title          string `json:"title"`
	CreatedAt      int64  `json:"createdAt"`
	OperationAt    int64  `json:"operationAt"`
	SelectionBased bool   `json:"selectionBased"`
	Truncated      bool   `json:"truncated"`
}

type HistoryEntry struct {
	ID             string `json:"id"`
	Text           string `json:"text"`
	Snippet        string `json:"snippet"`
	Format         string `json:"format"`
	Source         string `json:"source"`
	Mode           string `json:"mode"`
	URL            string `json:"url"`
	Hostname       string `json:"hostname"`
	Title          string `json:"title"`
	CreatedAt      int64  `json:"createdAt"`
	UpdatedAt      int64  `json:"updatedAt"`
	PinUpdatedAt   int64  `json:"pinUpdatedAt,omitempty"`
	Pinned         bool   `json:"pinned"`
	SelectionBased bool   `json:"selectionBased"`
	Truncated      bool   `json:"truncated"`
}

type HistoryTombstone struct {
	ID        string `json:"id"`
	DeletedAt int64  `json:"deletedAt"`
}

type Settings struct {
	HistoryEnabled bool   `json:"historyEnabled"`
	MaxItems       int    `json:"maxItems"`
	AutoStart      bool   `json:"autoStart"`
	Hotkey         string `json:"hotkey"`
}

type SettingsPatch struct {
	HistoryEnabled *bool   `json:"historyEnabled,omitempty"`
	MaxItems       *int    `json:"maxItems,omitempty"`
	AutoStart      *bool   `json:"autoStart,omitempty"`
	Hotkey         *string `json:"hotkey,omitempty"`
}

type StoreFile struct {
	SchemaVersion int                `json:"schemaVersion"`
	UpdatedAt     int64              `json:"updatedAt"`
	ClearedAt     int64              `json:"clearedAt,omitempty"`
	History       []HistoryEntry     `json:"history"`
	Tombstones    []HistoryTombstone `json:"tombstones,omitempty"`
	Settings      Settings           `json:"settings"`
}

type ListHistoryOptions struct {
	Limit int    `json:"limit"`
	Query string `json:"query"`
}

type RecordResult struct {
	Stored    bool   `json:"stored"`
	ID        string `json:"id,omitempty"`
	Reason    string `json:"reason,omitempty"`
	Truncated bool   `json:"truncated,omitempty"`
}

type FormatPreviewResult struct {
	Format    string        `json:"format"`
	Text      string        `json:"text"`
	Actions   []SmartAction `json:"actions"`
	Truncated bool          `json:"truncated,omitempty"`
}

type SmartAction struct {
	ID    string `json:"id"`
	Label string `json:"label"`
}

func DefaultSettings() Settings {
	return Settings{
		HistoryEnabled: true,
		MaxItems:       DefaultHistoryLimit,
		AutoStart:      false,
		Hotkey:         "Ctrl+Shift+Space",
	}
}
