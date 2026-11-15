package roster

import (
	"encoding/json"
	"fmt"
	"strconv"
	"strings"
)

// ParseJSON decodes an inline roster document.
func ParseJSON(raw []byte) (*Document, error) {
	var d Document
	if err := json.Unmarshal(raw, &d); err != nil {
		return nil, fmt.Errorf("roster JSON tidak valid: %w", err)
	}
	return &d, nil
}

// ParseYAML parses the small YAML subset a roster file needs:
//
//	title: Kantor Afif
//	tz: Asia/Jakarta
//	teams:
//	  - id: dev
//	    label: Ruang Tim Dev
//	agents:
//	  - id: dev
//	    name: Bima
//	    role: Lead Dev
//	    team: dev
//
// Scalars, nested one-level lists of mappings, blank lines and `#` comments are
// supported; anything else is rejected with an error rather than guessed at.
// Keeping this in-tree avoids a YAML dependency for one 15-line config file.
func ParseYAML(raw []byte) (*Document, error) {
	d := &Document{}
	lines := strings.Split(strings.ReplaceAll(string(raw), "\r\n", "\n"), "\n")

	section := "" // current top-level key with a list under it
	itemIdx := -1 // index into d.Agents/d.Teams being filled
	haveItem := false

	for n, line := range lines {
		line = stripComment(line)
		if strings.TrimSpace(line) == "" {
			continue
		}
		if strings.Contains(line, "\t") {
			return nil, fmt.Errorf("baris %d: tab tidak didukung di YAML roster, pakai spasi", n+1)
		}
		indent := len(line) - len(strings.TrimLeft(line, " "))
		body := strings.TrimSpace(line)

		if indent == 0 {
			// A list item may sit at column 0 under a key (`agents:\n- id: dev`),
			// which is what every hand-written YAML file actually looks like.
			if section != "" && (strings.HasPrefix(body, "- ") || body == "-") {
				rest := strings.TrimSpace(strings.TrimPrefix(body, "-"))
				itemIdx++
				haveItem = true
				switch section {
				case "agents":
					d.Agents = append(d.Agents, Entry{})
					d.Roster = nil
				case "teams":
					d.Teams = append(d.Teams, Team{})
				}
				if rest == "" {
					continue
				}
				if err := assignItem(d, section, itemIdx, rest, n+1); err != nil {
					return nil, err
				}
				continue
			}
			key, val, ok := splitKV(body)
			if !ok {
				return nil, fmt.Errorf("baris %d: harap `kunci: nilai`, dapat %q", n+1, body)
			}
			switch key {
			case "title":
				d.Title = val
			case "tz":
				d.TZ = val
			case "agents", "roster":
				section = "agents"
			case "teams":
				section = "teams"
			default:
				return nil, fmt.Errorf("baris %d: kunci %q tidak dikenal (title, tz, agents, teams)", n+1, key)
			}
			itemIdx, haveItem = -1, false
			if key == "title" || key == "tz" {
				// A scalar key ends any list: a stray `- id:` after it is an error,
				// not another agent.
				section = ""
			}
			// `agents: []` (and `teams: []`) is the flow form of an empty list.
			if key == "agents" || key == "teams" || key == "roster" {
				switch val {
				case "":
					// block list follows
				case "[]", "[ ]":
					// explicitly empty
				default:
					return nil, fmt.Errorf("baris %d: %s harus berupa daftar (pakai `%s:` lalu `- id: …`, atau `%s: []`)", n+1, key, key, key)
				}
			}
			continue
		}

		if section == "" {
			return nil, fmt.Errorf("baris %d: indentasi tanpa kunci induk", n+1)
		}
		if strings.HasPrefix(body, "- ") || body == "-" {
			rest := strings.TrimSpace(strings.TrimPrefix(body, "-"))
			itemIdx++
			haveItem = true
			switch section {
			case "agents":
				d.Agents = append(d.Agents, Entry{})
				d.Roster = nil
			case "teams":
				d.Teams = append(d.Teams, Team{})
			}
			if rest == "" {
				continue
			}
			if err := assignItem(d, section, itemIdx, rest, n+1); err != nil {
				return nil, err
			}
			continue
		}

		if !haveItem || itemIdx < 0 {
			return nil, fmt.Errorf("baris %d: properti di luar item daftar", n+1)
		}
		if err := assignItem(d, section, itemIdx, body, n+1); err != nil {
			return nil, err
		}
	}
	return d, nil
}

func assignItem(d *Document, section string, idx int, body string, lineNo int) error {
	key, val, ok := splitKV(body)
	if !ok {
		return fmt.Errorf("baris %d: harap `kunci: nilai`, dapat %q", lineNo, body)
	}
	switch section {
	case "agents":
		e := &d.Agents[idx]
		switch key {
		case "id":
			e.ID = val
		case "name":
			e.Name = val
		case "role":
			e.Role = val
		case "team":
			e.Team = val
		default:
			return fmt.Errorf("baris %d: properti agen %q tidak dikenal (id, name, role, team)", lineNo, key)
		}
	case "teams":
		t := &d.Teams[idx]
		switch key {
		case "id":
			t.ID = val
		case "label":
			t.Label = val
		default:
			return fmt.Errorf("baris %d: properti tim %q tidak dikenal (id, label)", lineNo, key)
		}
	}
	return nil
}

// splitComment removes a trailing `# comment` and keeps `#` inside values that
// are not preceded by whitespace.
func stripComment(line string) string {
	inSingle, inDouble := false, false
	for i, r := range line {
		switch r {
		case '\'':
			if !inDouble {
				inSingle = !inSingle
			}
		case '"':
			if !inSingle {
				inDouble = !inDouble
			}
		case '#':
			if !inSingle && !inDouble && (i == 0 || line[i-1] == ' ' || line[i-1] == '\t') {
				return strings.TrimRight(line[:i], " ")
			}
		}
	}
	return line
}

// splitKV splits `key: value`, unquoting and type-normalising the value.
func splitKV(s string) (string, string, bool) {
	i := strings.Index(s, ":")
	if i <= 0 {
		return "", "", false
	}
	key := strings.TrimSpace(s[:i])
	val := strings.TrimSpace(s[i+1:])
	return key, unquote(val), true
}

func unquote(v string) string {
	if len(v) >= 2 {
		if (v[0] == '"' && v[len(v)-1] == '"') || (v[0] == '\'' && v[len(v)-1] == '\'') {
			inner := v[1 : len(v)-1]
			if v[0] == '"' {
				if u, err := strconv.Unquote(v); err == nil {
					return u
				}
			}
			return inner
		}
	}
	return v
}
