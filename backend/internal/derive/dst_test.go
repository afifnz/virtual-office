package derive_test

import (
	"testing"
	"time"

	"officeapi/internal/derive"
	"officeapi/internal/store"
)

// 2026-10-25 in Europe/Lisbon is a 25-hour day (DST ends at 02:00 WEST). The
// office day must end at the next local midnight, not 86400 s after this one,
// or the last hour of the day is silently dropped.
func TestDSTDayWindowIsNotTwentyFourHours(t *testing.T) {
	loc, err := time.LoadLocation("Europe/Lisbon")
	if err != nil {
		t.Skipf("tzdata: %v", err)
	}
	start := time.Date(2026, 10, 25, 0, 0, 0, 0, loc)
	next := time.Date(2026, 10, 26, 0, 0, 0, 0, loc)
	if got := next.Sub(start).Hours(); got != 25 {
		t.Fatalf("test premise broken: day is %.0f h", got)
	}

	startF := float64(start.Unix())
	// 24.5 h into the day: still 2026-10-25 locally, but past start+86400.
	lateTS := startF + 24.5*3600
	snap := derive.Build(derive.Dataset{
		ProfileNames: []string{"dev"},
		Profiles: []derive.ProfileData{{
			Name:     "dev",
			Sessions: []store.Session{{ID: "s1", Started: startF + 60}},
			Msgs:     []store.Msg{{SessionID: "s1", Role: "user", TS: lateTS, Tokens: 10}},
		}},
		Now:      startF + 24.6*3600,
		Location: loc,
	})
	if len(snap.Agents) != 1 {
		t.Fatalf("agents = %+v", snap.Agents)
	}
	a := snap.Agents[0]
	if a.Today.Messages != 1 {
		t.Fatalf("message at 24.5h into a 25h day was dropped: today = %+v", a.Today)
	}
	if a.Today.Sessions != 1 {
		t.Fatalf("today sessions = %d", a.Today.Sessions)
	}
	// The 25th hour folds into the last bucket instead of growing the array.
	if len(a.Today.Hourly) != 24 {
		t.Fatalf("hourly length = %d", len(a.Today.Hourly))
	}
	if a.Today.Hourly[23] != 1 {
		t.Fatalf("hourly = %v, want the last bucket to hold the 25th hour", a.Today.Hourly)
	}
}

// The window must also stop at the next midnight: a message on the following
// day is not "today".
func TestDayWindowExcludesTomorrow(t *testing.T) {
	loc, err := time.LoadLocation("Europe/Lisbon")
	if err != nil {
		t.Skipf("tzdata: %v", err)
	}
	start := time.Date(2026, 10, 25, 0, 0, 0, 0, loc)
	next := time.Date(2026, 10, 26, 0, 0, 0, 0, loc)
	tomorrow := float64(next.Unix()) + 60

	snap := derive.Build(derive.Dataset{
		ProfileNames: []string{"dev"},
		Profiles: []derive.ProfileData{{
			Name:     "dev",
			Sessions: []store.Session{{ID: "s1", Started: tomorrow}},
			Msgs:     []store.Msg{{SessionID: "s1", Role: "user", TS: tomorrow}},
		}},
		// Still late on the 25th: tomorrow's row must fall outside "today".
		Now:      float64(start.Unix()) + 24.9*3600,
		Location: loc,
	})
	if got := snap.Agents[0].Today.Messages; got != 0 {
		t.Fatalf("tomorrow's message counted as today: %d", got)
	}
	if got := snap.Agents[0].Today.Sessions; got != 0 {
		t.Fatalf("tomorrow's session counted as today: %d", got)
	}
}

// The default (nil Location) keeps the historical WIB day boundary.
func TestNilLocationStaysWIB(t *testing.T) {
	// 2026-11-15T18:00Z = 2026-11-16T01:00 WIB, so "today" starts at 17:00Z.
	now := float64(time.Date(2026, 11, 15, 18, 0, 0, 0, time.UTC).Unix())
	snap := derive.Build(derive.Dataset{
		ProfileNames: []string{"dev"},
		Now:          now,
	})
	if len(snap.Agents) != 1 {
		t.Fatalf("agents = %+v", snap.Agents)
	}
	if snap.Agents[0].Status != "offline" {
		t.Fatalf("status = %q", snap.Agents[0].Status)
	}
}
