package companion

import (
	"bytes"
	"encoding/binary"
	"encoding/json"
	"errors"
	"io"
	"strings"
	"testing"
)

func TestReadNativeMessage(t *testing.T) {
	payload, _ := json.Marshal(Envelope{
		ID:      "abc",
		Version: ProtocolVersion,
		Type:    "PING",
	})
	var buffer bytes.Buffer
	if err := binary.Write(&buffer, binary.LittleEndian, uint32(len(payload))); err != nil {
		t.Fatal(err)
	}
	buffer.Write(payload)

	message, err := ReadNativeMessage(&buffer)
	if err != nil {
		t.Fatal(err)
	}
	if message.Type != "PING" || message.ID != "abc" {
		t.Fatalf("unexpected envelope: %#v", message)
	}
}

func TestWriteNativeMessage(t *testing.T) {
	input := Response{ID: "abc", OK: true, Payload: map[string]any{"pong": true}}
	var buffer bytes.Buffer
	if err := WriteNativeMessage(&buffer, input); err != nil {
		t.Fatal(err)
	}

	var length uint32
	if err := binary.Read(&buffer, binary.LittleEndian, &length); err != nil {
		t.Fatal(err)
	}
	if length == 0 {
		t.Fatal("expected response length")
	}
}

func TestHandleEnvelopeSettingsUpdate(t *testing.T) {
	service := newTestService(t)
	maxItems := 42
	payload, _ := json.Marshal(SettingsPatch{MaxItems: &maxItems})
	response := HandleEnvelope(Envelope{
		ID:      "settings-1",
		Version: ProtocolVersion,
		Type:    "SETTINGS_UPDATE",
		Payload: payload,
	}, service)
	if !response.OK {
		t.Fatalf("expected settings update ok, got %#v", response)
	}
}

func TestHandleEnvelopeRejectsMalformedPayloads(t *testing.T) {
	service := newTestService(t)
	cases := []Envelope{
		{ID: "ping", Version: ProtocolVersion, Type: "PING", Payload: json.RawMessage("{")},
		{ID: "list", Version: ProtocolVersion, Type: "HISTORY_LIST", Payload: json.RawMessage("{")},
		{ID: "delete", Version: ProtocolVersion, Type: "HISTORY_DELETE", Payload: json.RawMessage("{}")},
		{ID: "pin", Version: ProtocolVersion, Type: "HISTORY_PIN", Payload: json.RawMessage(`{"pinned":true}`)},
	}

	for _, item := range cases {
		response := HandleEnvelope(item, service)
		if response.OK || response.Error == nil || response.Error.Code != "BAD_PAYLOAD" {
			t.Fatalf("expected BAD_PAYLOAD for %s, got %#v", item.Type, response)
		}
	}
}

func TestHandleEnvelopeResolvesHistoryMutationByText(t *testing.T) {
	service := newTestService(t)
	record, err := service.RecordClipboardEvent(ClipboardEvent{Text: "protocol identity"})
	if err != nil {
		t.Fatal(err)
	}

	pinPayload, _ := json.Marshal(map[string]any{
		"id":     "extension-local-id",
		"text":   "protocol identity",
		"pinned": true,
	})
	pinned := HandleEnvelope(Envelope{
		ID:      "pin-by-text",
		Version: ProtocolVersion,
		Type:    "HISTORY_PIN",
		Payload: pinPayload,
	}, service)
	if !pinned.OK {
		t.Fatalf("expected pin by text fallback, got %#v", pinned)
	}

	deletePayload, _ := json.Marshal(map[string]any{
		"id":   "extension-local-id",
		"text": "protocol identity",
	})
	deleted := HandleEnvelope(Envelope{
		ID:      "delete-by-text",
		Version: ProtocolVersion,
		Type:    "HISTORY_DELETE",
		Payload: deletePayload,
	}, service)
	if !deleted.OK {
		t.Fatalf("expected delete by text fallback, got %#v", deleted)
	}

	history, err := service.ListHistory(ListHistoryOptions{Limit: 10})
	if err != nil {
		t.Fatal(err)
	}
	if len(history) != 0 {
		t.Fatalf("expected entry %q to be deleted, got %#v", record.ID, history)
	}
}

func TestHandleEnvelopeHonorsHistoryOperationAt(t *testing.T) {
	service := newTestService(t)
	record, err := service.RecordClipboardEvent(ClipboardEvent{
		Text:        "protocol conflict",
		CreatedAt:   100,
		OperationAt: 200,
	})
	if err != nil {
		t.Fatal(err)
	}

	deletePayload, _ := json.Marshal(map[string]any{
		"id":          record.ID,
		"text":        "protocol conflict",
		"operationAt": 150,
	})
	deleted := HandleEnvelope(Envelope{
		ID:      "stale-delete",
		Version: ProtocolVersion,
		Type:    "HISTORY_DELETE",
		Payload: deletePayload,
	}, service)
	if !deleted.OK {
		t.Fatalf("expected ok stale delete response, got %#v", deleted)
	}

	history, err := service.ListHistory(ListHistoryOptions{Limit: 10})
	if err != nil {
		t.Fatal(err)
	}
	if len(history) != 1 || history[0].ID != record.ID {
		t.Fatalf("expected stale protocol delete to preserve entry, got %#v", history)
	}
}

func TestHistoryListResponseFitsNativeMessageLimit(t *testing.T) {
	history := make([]HistoryEntry, 0, 8)
	for index := 0; index < 8; index++ {
		history = append(history, HistoryEntry{
			ID:        string(rune('a' + index)),
			Text:      strings.Repeat("x", MaxNativeResponseBytes/3),
			Snippet:   "large",
			CreatedAt: int64(index + 1),
		})
	}

	response := historyListResponse("large", history)
	if !response.OK {
		t.Fatalf("expected trimmed ok response, got %#v", response)
	}
	payload, err := json.Marshal(response)
	if err != nil {
		t.Fatal(err)
	}
	if len(payload) > MaxNativeResponseBytes {
		t.Fatalf("response exceeded native response limit: %d", len(payload))
	}
	shape, ok := response.Payload.(map[string]any)
	if !ok {
		t.Fatalf("unexpected payload shape: %#v", response.Payload)
	}
	if shape["hasMore"] != true || shape["total"] != len(history) {
		t.Fatalf("expected hasMore=true with original total, got %#v", shape)
	}
}

func TestHistoryListResponseTruncatesOversizedEntry(t *testing.T) {
	history := []HistoryEntry{{
		ID:        "oversized",
		Text:      strings.Repeat("x", MaxNativeResponseBytes+1024),
		Snippet:   strings.Repeat("s", 2048),
		Title:     strings.Repeat("t", 4096),
		CreatedAt: 1,
	}}

	response := historyListResponse("oversized", history)
	if !response.OK {
		t.Fatalf("expected ok response, got %#v", response)
	}
	payload, err := json.Marshal(response)
	if err != nil {
		t.Fatal(err)
	}
	if len(payload) > MaxNativeResponseBytes {
		t.Fatalf("response exceeded native response limit: %d", len(payload))
	}
	shape, ok := response.Payload.(map[string]any)
	if !ok {
		t.Fatalf("unexpected payload shape: %#v", response.Payload)
	}
	entries, ok := shape["history"].([]HistoryEntry)
	if !ok || len(entries) != 1 {
		t.Fatalf("unexpected history shape: %#v", shape["history"])
	}
	if !entries[0].Truncated || len(entries[0].Text) > MaxNativeResponseTextBytes {
		t.Fatalf("expected oversized entry to be marked truncated, got %#v", entries[0])
	}
}

func TestHistoryListResponseKeepsQuoteHeavyEntryUnderLimit(t *testing.T) {
	history := []HistoryEntry{{
		ID:        "quoted",
		Text:      strings.Repeat(`"`, MaxStoredTextBytes),
		Snippet:   "quoted",
		CreatedAt: 1,
	}}

	response := historyListResponse("quoted", history)
	if !response.OK {
		t.Fatalf("expected ok response, got %#v", response)
	}
	payload, err := json.Marshal(response)
	if err != nil {
		t.Fatal(err)
	}
	if len(payload) > MaxNativeResponseBytes {
		t.Fatalf("response exceeded native response limit: %d", len(payload))
	}
	shape, ok := response.Payload.(map[string]any)
	if !ok {
		t.Fatalf("unexpected payload shape: %#v", response.Payload)
	}
	entries, ok := shape["history"].([]HistoryEntry)
	if !ok || len(entries) != 1 {
		t.Fatalf("expected one bounded history entry, got %#v", shape["history"])
	}
	if !entries[0].Truncated || len(entries[0].Text) > MaxNativeResponseTextBytes {
		t.Fatalf("expected quote-heavy entry to be response-truncated, got %#v", entries[0])
	}
}

type shortWriter struct {
	writes int
}

func (writer *shortWriter) Write(payload []byte) (int, error) {
	writer.writes++
	if writer.writes == 1 {
		return len(payload), nil
	}
	return 0, nil
}

func TestWriteNativeMessageDetectsShortPayloadWrite(t *testing.T) {
	err := WriteNativeMessage(&shortWriter{}, Response{ID: "short", OK: true})
	if !errors.Is(err, io.ErrShortWrite) {
		t.Fatalf("expected short write error, got %v", err)
	}
}
