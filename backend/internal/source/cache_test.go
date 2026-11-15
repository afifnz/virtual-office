package source

import (
	"context"
	"testing"
	"time"

	"officeapi/internal/config"
	"officeapi/internal/fixture"
)

func TestLocalSnapshotIsCachedForTTL(t *testing.T) {
	home := fixture.New(t)
	home.Profile("default").Close()
	src := NewLocal(config.Config{Home: home.Dir, Profiles: []string{"default"}}, quiet()).(*local)

	clock := time.Unix(1800000000, 0)
	src.clock = func() time.Time { return clock }

	first, err := src.Snapshot(context.Background(), clock)
	if err != nil {
		t.Fatalf("snapshot: %v", err)
	}

	// Inside the TTL: same snapshot even though the caller's `now` moved.
	clock = clock.Add(SnapshotTTL - time.Millisecond)
	again, _ := src.Snapshot(context.Background(), clock)
	if again.Now != first.Now {
		t.Fatalf("now = %v, want cached %v", again.Now, first.Now)
	}

	// Past the TTL: rebuilt.
	clock = clock.Add(time.Second)
	fresh, _ := src.Snapshot(context.Background(), clock)
	if fresh.Now == first.Now {
		t.Fatal("snapshot not rebuilt after TTL")
	}
}
