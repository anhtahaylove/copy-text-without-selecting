package companion

import (
	"bufio"
	"bytes"
	"encoding/binary"
	"encoding/json"
	"errors"
	"fmt"
	"io"
)

func RunNativeMessaging(input io.Reader, output io.Writer, service *Service) error {
	reader := bufio.NewReader(input)
	for {
		message, err := ReadNativeMessage(reader)
		if errors.Is(err, io.EOF) {
			return nil
		}
		if err != nil {
			return err
		}

		resp := HandleEnvelope(message, service)
		if err := WriteNativeMessage(output, resp); err != nil {
			return err
		}
	}
}

func ReadNativeMessage(reader io.Reader) (Envelope, error) {
	var length uint32
	if err := binary.Read(reader, binary.LittleEndian, &length); err != nil {
		return Envelope{}, err
	}
	if length == 0 || length > MaxNativeRequestBytes {
		return Envelope{}, fmt.Errorf("invalid native message length: %d", length)
	}

	buffer := make([]byte, length)
	if _, err := io.ReadFull(reader, buffer); err != nil {
		return Envelope{}, err
	}

	var message Envelope
	if err := json.Unmarshal(buffer, &message); err != nil {
		return Envelope{}, err
	}
	return message, nil
}

func WriteNativeMessage(writer io.Writer, value Response) error {
	payload, err := json.Marshal(value)
	if err != nil {
		return err
	}
	if len(payload) > MaxNativeResponseBytes {
		return fmt.Errorf("native response too large: %d bytes", len(payload))
	}

	if err := binary.Write(writer, binary.LittleEndian, uint32(len(payload))); err != nil {
		return err
	}
	_, err = io.Copy(writer, bytes.NewReader(payload))
	return err
}

func HandleEnvelope(message Envelope, service *Service) Response {
	if message.Version != ProtocolVersion {
		return Fail(message.ID, "UNSUPPORTED_VERSION", "Unsupported protocol version.", false)
	}

	switch message.Type {
	case "PING":
		var payload struct {
			ExtensionVersion string `json:"extensionVersion"`
		}
		if err := decodePayload(message.Payload, &payload); err != nil {
			return Fail(message.ID, "BAD_PAYLOAD", err.Error(), false)
		}
		return OK(message.ID, service.Ping(payload.ExtensionVersion))
	case "CLIPBOARD_EVENT":
		return handleClipboardEvent(message, service)
	case "HISTORY_LIST":
		return handleHistoryList(message, service)
	case "HISTORY_DELETE":
		return handleHistoryDelete(message, service)
	case "HISTORY_CLEAR":
		return handleHistoryClear(message, service)
	case "HISTORY_PIN":
		return handleHistoryPin(message, service)
	case "FORMAT_PREVIEW":
		return handleFormatPreview(message, service)
	case "SETTINGS_GET":
		return handleSettingsGet(message, service)
	case "SETTINGS_UPDATE":
		return handleSettingsUpdate(message, service)
	case "OPEN_APP":
		return OK(message.ID, map[string]any{"opened": service.OpenApp()})
	case "PRIVACY_GET":
		return handlePrivacyGet(message, service)
	default:
		return Fail(message.ID, "UNKNOWN_MESSAGE", "Unknown message type.", false)
	}
}

func handleClipboardEvent(message Envelope, service *Service) Response {
	var event ClipboardEvent
	if err := json.Unmarshal(message.Payload, &event); err != nil {
		return Fail(message.ID, "BAD_PAYLOAD", err.Error(), false)
	}

	result, err := service.RecordClipboardEvent(event)
	if err != nil {
		return Fail(message.ID, "STORE_WRITE_FAILED", err.Error(), true)
	}
	return OK(message.ID, result)
}

func handleHistoryList(message Envelope, service *Service) Response {
	var options ListHistoryOptions
	if err := decodePayload(message.Payload, &options); err != nil {
		return Fail(message.ID, "BAD_PAYLOAD", err.Error(), false)
	}

	history, err := service.ListHistory(options)
	if err != nil {
		return Fail(message.ID, "STORE_READ_FAILED", err.Error(), true)
	}
	return historyListResponse(message.ID, history)
}

func handleHistoryDelete(message Envelope, service *Service) Response {
	var payload struct {
		ID          string `json:"id"`
		Text        string `json:"text"`
		OperationAt int64  `json:"operationAt"`
	}
	if err := json.Unmarshal(message.Payload, &payload); err != nil {
		return Fail(message.ID, "BAD_PAYLOAD", err.Error(), false)
	}
	if payload.ID == "" && payload.Text == "" {
		return Fail(message.ID, "BAD_PAYLOAD", "history id or text is required.", false)
	}
	deleted, err := service.DeleteHistoryResolvedAt(payload.ID, payload.Text, payload.OperationAt)
	if err != nil {
		return Fail(message.ID, "STORE_WRITE_FAILED", err.Error(), true)
	}
	return OK(message.ID, map[string]any{"deleted": deleted})
}

func handleHistoryClear(message Envelope, service *Service) Response {
	var payload struct {
		OperationAt int64 `json:"operationAt"`
	}
	if err := decodePayload(message.Payload, &payload); err != nil {
		return Fail(message.ID, "BAD_PAYLOAD", err.Error(), false)
	}
	cleared, err := service.ClearHistoryAt(payload.OperationAt)
	if err != nil {
		return Fail(message.ID, "STORE_WRITE_FAILED", err.Error(), true)
	}
	return OK(message.ID, map[string]any{"cleared": cleared})
}

func handleHistoryPin(message Envelope, service *Service) Response {
	var payload struct {
		ID          string `json:"id"`
		Text        string `json:"text"`
		Pinned      bool   `json:"pinned"`
		OperationAt int64  `json:"operationAt"`
	}
	if err := json.Unmarshal(message.Payload, &payload); err != nil {
		return Fail(message.ID, "BAD_PAYLOAD", err.Error(), false)
	}
	if payload.ID == "" && payload.Text == "" {
		return Fail(message.ID, "BAD_PAYLOAD", "history id or text is required.", false)
	}
	changed, err := service.PinHistoryResolvedAt(payload.ID, payload.Text, payload.Pinned, payload.OperationAt)
	if err != nil {
		return Fail(message.ID, "STORE_WRITE_FAILED", err.Error(), true)
	}
	return OK(message.ID, map[string]any{"changed": changed})
}

func handleFormatPreview(message Envelope, service *Service) Response {
	var payload struct {
		Text   string `json:"text"`
		Action string `json:"action"`
	}
	if err := json.Unmarshal(message.Payload, &payload); err != nil {
		return Fail(message.ID, "BAD_PAYLOAD", err.Error(), false)
	}
	return OK(message.ID, service.FormatPreview(payload.Text, payload.Action))
}

func handleSettingsGet(message Envelope, service *Service) Response {
	settings, err := service.GetSettings()
	if err != nil {
		return Fail(message.ID, "STORE_READ_FAILED", err.Error(), true)
	}
	return OK(message.ID, map[string]any{"settings": settings})
}

func handleSettingsUpdate(message Envelope, service *Service) Response {
	var patch SettingsPatch
	if err := json.Unmarshal(message.Payload, &patch); err != nil {
		return Fail(message.ID, "BAD_PAYLOAD", err.Error(), false)
	}
	settings, err := service.UpdateSettings(patch)
	if err != nil {
		return Fail(message.ID, "STORE_WRITE_FAILED", err.Error(), true)
	}
	return OK(message.ID, map[string]any{"settings": settings})
}

func handlePrivacyGet(message Envelope, service *Service) Response {
	settings, err := service.GetSettings()
	if err != nil {
		return Fail(message.ID, "STORE_READ_FAILED", err.Error(), true)
	}
	return OK(message.ID, map[string]any{
		"persistentHistory": settings.HistoryEnabled,
		"pauseCapture":      !settings.HistoryEnabled,
		"storagePath":       service.StorePath(),
		"network":           false,
	})
}

func OK(id string, payload any) Response {
	return Response{ID: id, OK: true, Payload: payload}
}

func Fail(id string, code string, message string, recoverable bool) Response {
	return Response{
		ID: id,
		OK: false,
		Error: &ErrorShape{
			Code:        code,
			Message:     message,
			Recoverable: recoverable,
		},
	}
}

func decodePayload(payload json.RawMessage, target any) error {
	if len(payload) == 0 || string(payload) == "null" {
		return nil
	}
	return json.Unmarshal(payload, target)
}

func historyListResponse(id string, history []HistoryEntry) Response {
	total := len(history)
	hasMore := false
	history = nativeResponseHistory(history)
	for {
		response := OK(id, map[string]any{
			"history": history,
			"total":   total,
			"hasMore": hasMore,
		})
		payload, err := json.Marshal(response)
		if err == nil && len(payload) <= MaxNativeResponseBytes {
			return response
		}
		if len(history) == 0 {
			return Fail(id, "RESPONSE_TOO_LARGE", "History response is too large.", true)
		}
		history = history[:len(history)-1]
		hasMore = true
	}
}

func nativeResponseHistory(history []HistoryEntry) []HistoryEntry {
	entries := make([]HistoryEntry, 0, len(history))
	for _, entry := range history {
		entries = append(entries, nativeResponseEntry(entry))
	}
	return entries
}

func nativeResponseEntry(entry HistoryEntry) HistoryEntry {
	next := entry
	if text, truncated := truncateStringBytes(next.Text, MaxNativeResponseTextBytes); truncated {
		next.Text = text
		next.Truncated = true
	}
	next.Snippet, _ = truncateStringBytes(next.Snippet, 512)
	next.ID, _ = truncateStringBytes(next.ID, 256)
	next.Source, _ = truncateStringBytes(next.Source, 128)
	next.Mode, _ = truncateStringBytes(next.Mode, 64)
	next.Format, _ = truncateStringBytes(next.Format, 64)
	next.URL, _ = truncateStringBytes(next.URL, 2048)
	next.Hostname, _ = truncateStringBytes(next.Hostname, 255)
	next.Title, _ = truncateStringBytes(next.Title, 512)
	return next
}
