package companion

import (
	"bytes"
	"encoding/base64"
	"encoding/json"
	"fmt"
	"strconv"
	"strings"
	"time"
	"unicode"
	"unicode/utf8"
)

func DetectFormat(text string) string {
	trimmed := strings.TrimSpace(text)
	lower := strings.ToLower(trimmed)
	if trimmed == "" {
		return "plain"
	}
	if isJWT(trimmed) {
		return "jwt"
	}
	if isTimestamp(trimmed) {
		return "timestamp"
	}
	if isDate(trimmed) {
		return "date"
	}
	if json.Valid([]byte(trimmed)) && (strings.HasPrefix(trimmed, "{") || strings.HasPrefix(trimmed, "[")) {
		return "json"
	}
	for _, keyword := range []string{"select", "insert", "update", "delete", "with", "create", "alter", "drop"} {
		if lower == keyword || strings.HasPrefix(lower, keyword+" ") {
			return "sql"
		}
	}
	if looksBase64(trimmed) {
		return "base64"
	}
	return "plain"
}

func ApplyAction(text string, action string) string {
	switch action {
	case "prettyJson":
		var out bytes.Buffer
		if err := json.Indent(&out, []byte(strings.TrimSpace(text)), "", "  "); err == nil {
			return out.String()
		}
	case "minifyJson":
		var out bytes.Buffer
		if err := json.Compact(&out, []byte(strings.TrimSpace(text))); err == nil {
			return out.String()
		}
	case "formatSql":
		return formatSQL(text)
	case "minifySql":
		return minifySQL(text)
	case "decodeJwt":
		return decodeJWT(text)
	case "timestampToIso", "timestampToDate":
		return timestampToISO(text)
	case "isoToTimestamp", "dateToTimestamp":
		return isoToTimestamp(text)
	case "upper":
		return strings.ToUpper(text)
	case "lower":
		return strings.ToLower(text)
	case "title":
		return toTitle(text)
	case "camel":
		return toCamel(text)
	case "snake":
		return toSnake(text)
	case "base64Encode":
		return base64.StdEncoding.EncodeToString([]byte(text))
	case "base64Decode":
		decoded, err := base64.StdEncoding.DecodeString(strings.TrimSpace(text))
		if err == nil {
			return string(decoded)
		}
	}
	return text
}

func ActionsForFormat(format string) []SmartAction {
	switch format {
	case "json":
		return []SmartAction{{ID: "prettyJson", Label: "Pretty JSON"}, {ID: "minifyJson", Label: "Minify JSON"}}
	case "sql":
		return []SmartAction{{ID: "formatSql", Label: "Format SQL"}, {ID: "minifySql", Label: "Minify SQL"}}
	case "jwt":
		return []SmartAction{{ID: "decodeJwt", Label: "Decode JWT (unverified)"}}
	case "timestamp":
		return []SmartAction{{ID: "timestampToIso", Label: "To ISO"}}
	case "date":
		return []SmartAction{{ID: "isoToTimestamp", Label: "To timestamp"}}
	case "base64":
		return []SmartAction{{ID: "base64Decode", Label: "Decode Base64"}}
	default:
		return []SmartAction{
			{ID: "upper", Label: "UPPER"},
			{ID: "lower", Label: "lower"},
			{ID: "title", Label: "Title"},
			{ID: "camel", Label: "camelCase"},
			{ID: "snake", Label: "snake_case"},
			{ID: "base64Encode", Label: "Encode Base64"},
		}
	}
}

func isJWT(text string) bool {
	parts := strings.Split(text, ".")
	if len(parts) != 3 || !strings.HasPrefix(parts[0], "eyJ") {
		return false
	}
	header, err := base64.RawURLEncoding.DecodeString(parts[0])
	if err != nil || !json.Valid(header) {
		return false
	}
	payload, err := base64.RawURLEncoding.DecodeString(parts[1])
	return err == nil && json.Valid(payload)
}

func isTimestamp(text string) bool {
	if len(text) != 10 && len(text) != 13 {
		return false
	}
	for _, char := range text {
		if char < '0' || char > '9' {
			return false
		}
	}
	value, err := strconv.ParseInt(text, 10, 64)
	if err != nil {
		return false
	}
	var date time.Time
	if len(text) == 13 {
		date = time.UnixMilli(value)
	} else {
		date = time.Unix(value, 0)
	}
	year := date.UTC().Year()
	return year > 1975 && year < 2100
}

func isDate(text string) bool {
	layouts := []string{
		time.RFC3339,
		"2006-01-02 15:04:05",
		"2006-01-02",
	}
	for _, layout := range layouts {
		if _, err := time.Parse(layout, text); err == nil {
			return true
		}
	}
	return false
}

func looksBase64(text string) bool {
	if len(text) < 12 || len(text)%4 != 0 || strings.ContainsAny(text, " \r\n\t") {
		return false
	}
	decoded, err := base64.StdEncoding.DecodeString(text)
	if err != nil || len(decoded) == 0 || !utf8.Valid(decoded) {
		return false
	}
	printable := 0
	for _, char := range string(decoded) {
		if char == '\n' || char == '\r' || char == '\t' || !unicode.IsControl(char) {
			printable++
		}
	}
	if printable < len([]rune(string(decoded))) {
		return false
	}
	return base64.StdEncoding.EncodeToString(decoded) == text
}

func formatSQL(text string) string {
	return strings.TrimSpace(transformSQLCode(text, func(segment string) string {
		normalized := collapseSQLCodeSegment(segment)
		replacements := []struct {
			from string
			to   string
		}{
			{"select ", "SELECT "},
			{" from ", "\nFROM "},
			{" where ", "\nWHERE "},
			{" group by ", "\nGROUP BY "},
			{" order by ", "\nORDER BY "},
			{" left join ", "\nLEFT JOIN "},
			{" right join ", "\nRIGHT JOIN "},
			{" inner join ", "\nINNER JOIN "},
			{" join ", "\nJOIN "},
			{" values ", "\nVALUES "},
			{" set ", "\nSET "},
		}
		out := normalized
		out = replaceWordPrefixInsensitive(out, "select", "SELECT")
		out = replaceWordPrefixInsensitive(out, "insert", "INSERT")
		out = replaceWordPrefixInsensitive(out, "update", "UPDATE")
		out = replaceWordPrefixInsensitive(out, "delete", "DELETE")
		out = replaceWordPrefixInsensitive(out, "with", "WITH")
		out = replacePhrasePrefixInsensitive(out, "group by", "GROUP BY")
		out = replacePhrasePrefixInsensitive(out, "order by", "ORDER BY")
		out = replacePhrasePrefixInsensitive(out, "left join", "LEFT JOIN")
		out = replacePhrasePrefixInsensitive(out, "right join", "RIGHT JOIN")
		out = replacePhrasePrefixInsensitive(out, "inner join", "INNER JOIN")
		out = replaceWordPrefixInsensitive(out, "from", "FROM")
		out = replaceWordPrefixInsensitive(out, "where", "WHERE")
		out = replaceWordPrefixInsensitive(out, "having", "HAVING")
		out = replaceWordPrefixInsensitive(out, "limit", "LIMIT")
		out = replaceWordPrefixInsensitive(out, "join", "JOIN")
		out = replaceWordPrefixInsensitive(out, "values", "VALUES")
		out = replaceWordPrefixInsensitive(out, "set", "SET")
		for _, replacement := range replacements {
			out = replaceInsensitive(out, replacement.from, replacement.to)
		}
		return out
	}))
}

func minifySQL(text string) string {
	return strings.TrimSpace(transformSQLCode(text, func(segment string) string {
		return collapseSQLCodeSegment(segment)
	}))
}

func collapseSQLCodeSegment(segment string) string {
	if strings.TrimSpace(segment) == "" {
		if segment == "" {
			return ""
		}
		return " "
	}
	collapsed := strings.Join(strings.Fields(segment), " ")
	if strings.HasPrefix(segment, " ") || strings.HasPrefix(segment, "\n") || strings.HasPrefix(segment, "\t") || strings.HasPrefix(segment, "\r") {
		collapsed = " " + collapsed
	}
	if strings.HasSuffix(segment, " ") || strings.HasSuffix(segment, "\n") || strings.HasSuffix(segment, "\t") || strings.HasSuffix(segment, "\r") {
		collapsed += " "
	}
	return collapsed
}

func transformSQLCode(text string, transform func(string) string) string {
	var output strings.Builder
	var code strings.Builder

	flushCode := func() {
		if code.Len() == 0 {
			return
		}
		output.WriteString(transform(code.String()))
		code.Reset()
	}

	for index := 0; index < len(text); {
		if strings.HasPrefix(text[index:], "--") {
			flushCode()
			end := strings.IndexByte(text[index:], '\n')
			if end < 0 {
				output.WriteString(text[index:])
				break
			}
			output.WriteString(text[index : index+end+1])
			index += end + 1
			continue
		}
		if strings.HasPrefix(text[index:], "/*") {
			flushCode()
			end := strings.Index(text[index+2:], "*/")
			if end < 0 {
				output.WriteString(text[index:])
				break
			}
			end += index + 4
			output.WriteString(text[index:end])
			index = end
			continue
		}
		if text[index] == '\'' || text[index] == '"' {
			flushCode()
			quote := text[index]
			start := index
			index++
			for index < len(text) {
				if text[index] == quote {
					if index+1 < len(text) && text[index+1] == quote {
						index += 2
						continue
					}
					index++
					break
				}
				index++
			}
			output.WriteString(text[start:index])
			continue
		}
		code.WriteByte(text[index])
		index++
	}
	flushCode()
	return output.String()
}

func replaceInsensitive(input string, needle string, replacement string) string {
	if needle == "" {
		return input
	}

	lowerInput := strings.ToLower(input)
	lowerNeedle := strings.ToLower(needle)
	var builder strings.Builder
	start := 0
	for {
		index := strings.Index(lowerInput[start:], lowerNeedle)
		if index < 0 {
			builder.WriteString(input[start:])
			break
		}
		index += start
		builder.WriteString(input[start:index])
		builder.WriteString(replacement)
		start = index + len(needle)
	}
	return builder.String()
}

func replaceWordPrefixInsensitive(input string, needle string, replacement string) string {
	return replacePhrasePrefixInsensitive(input, needle, replacement)
}

func replacePhrasePrefixInsensitive(input string, needle string, replacement string) string {
	trimmedLeft := strings.TrimLeft(input, " \t\r\n")
	prefixLen := len(input) - len(trimmedLeft)
	if len(trimmedLeft) < len(needle) || !strings.EqualFold(trimmedLeft[:len(needle)], needle) {
		return input
	}
	if len(trimmedLeft) > len(needle) {
		next := trimmedLeft[len(needle)]
		if (next >= 'a' && next <= 'z') || (next >= 'A' && next <= 'Z') || (next >= '0' && next <= '9') || next == '_' {
			return input
		}
	}
	return input[:prefixLen] + replacement + trimmedLeft[len(needle):]
}

func decodeJWT(text string) string {
	parts := strings.Split(strings.TrimSpace(text), ".")
	if len(parts) != 3 {
		return text
	}
	header := decodeJWTPart(parts[0])
	payload := decodeJWTPart(parts[1])
	if header == "" || payload == "" {
		return text
	}
	return "HEADER\n" + header + "\n\nPAYLOAD\n" + payload
}

func decodeJWTPart(value string) string {
	decoded, err := base64.RawURLEncoding.DecodeString(value)
	if err != nil {
		return ""
	}
	var pretty bytes.Buffer
	if err := json.Indent(&pretty, decoded, "", "  "); err == nil {
		return pretty.String()
	}
	return string(decoded)
}

func timestampToISO(text string) string {
	value, err := strconv.ParseInt(strings.TrimSpace(text), 10, 64)
	if err != nil {
		return text
	}
	if len(strings.TrimSpace(text)) == 13 {
		return time.UnixMilli(value).UTC().Format(time.RFC3339)
	}
	return time.Unix(value, 0).UTC().Format(time.RFC3339)
}

func isoToTimestamp(text string) string {
	layouts := []string{time.RFC3339, "2006-01-02 15:04:05", "2006-01-02"}
	for _, layout := range layouts {
		parsed, err := time.Parse(layout, strings.TrimSpace(text))
		if err == nil {
			return fmt.Sprintf("%d", parsed.Unix())
		}
	}
	return text
}

func toTitle(text string) string {
	words := splitWords(text)
	for index, word := range words {
		if word == "" {
			continue
		}
		runes := []rune(strings.ToLower(word))
		runes[0] = unicode.ToUpper(runes[0])
		words[index] = string(runes)
	}
	return strings.Join(words, " ")
}

func toCamel(text string) string {
	words := splitWords(text)
	if len(words) == 0 {
		return ""
	}
	for index, word := range words {
		word = strings.ToLower(word)
		if index > 0 && word != "" {
			runes := []rune(word)
			runes[0] = unicode.ToUpper(runes[0])
			word = string(runes)
		}
		words[index] = word
	}
	return strings.Join(words, "")
}

func toSnake(text string) string {
	words := splitWords(text)
	for index, word := range words {
		words[index] = strings.ToLower(word)
	}
	return strings.Join(words, "_")
}

func splitWords(text string) []string {
	fields := strings.FieldsFunc(text, func(char rune) bool {
		return !(unicode.IsLetter(char) || unicode.IsDigit(char))
	})
	words := make([]string, 0, len(fields))
	for _, field := range fields {
		if field != "" {
			words = append(words, field)
		}
	}
	return words
}
