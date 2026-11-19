package ratelimit

import (
	"testing"
	"time"
)

// fixedClock lets a test move time without sleeping.
func newTestLimiter(perMin, burst int) (*Limiter, *time.Time) {
	now := time.Unix(1800000000, 0)
	l := New(perMin, burst)
	l.clock = func() time.Time { return now }
	return l, &now
}

func allowN(t *testing.T, l *Limiter, key string, n int) int {
	t.Helper()
	ok := 0
	for i := 0; i < n; i++ {
		if passed, _ := l.Allow(key); passed {
			ok++
		}
	}
	return ok
}

// The bucket must hand out exactly `burst` tokens and then refuse, with a
// Retry-After hint that matches the refill rate.
func TestAllowDeniesAfterBurst(t *testing.T) {
	l, _ := newTestLimiter(60, 3) // 1 token/s, burst 3

	if got := allowN(t, l, "1.2.3.4", 10); got != 3 {
		t.Fatalf("allowed %d requests, want 3", got)
	}
	ok, retry := l.Allow("1.2.3.4")
	if ok {
		t.Fatal("fourth request allowed, want denied")
	}
	if retry < time.Second || retry > 2*time.Second {
		t.Fatalf("retry after = %v, want ~1s", retry)
	}
}

// A different key keeps its own bucket: one noisy IP must not starve another.
func TestBucketsArePerKey(t *testing.T) {
	l, _ := newTestLimiter(60, 1)
	if ok, _ := l.Allow("a"); !ok {
		t.Fatal("first request for a denied")
	}
	if ok, _ := l.Allow("a"); ok {
		t.Fatal("second request for a denied key allowed")
	}
	if ok, _ := l.Allow("b"); !ok {
		t.Fatal("a fresh key was denied")
	}
}

// Waiting out the refill window must give the caller its tokens back.
func TestRecoversAfterWindow(t *testing.T) {
	l, now := newTestLimiter(60, 2) // 1 token/s

	allowN(t, l, "ip", 5) // drain
	if ok, _ := l.Allow("ip"); ok {
		t.Fatal("allowed while empty")
	}

	*now = now.Add(time.Second)
	if ok, _ := l.Allow("ip"); !ok {
		t.Fatal("one second later the bucket should have a token")
	}
	if ok, _ := l.Allow("ip"); ok {
		t.Fatal("only one token refilled")
	}

	// Long idle: refill stops at burst, never above it.
	*now = now.Add(time.Hour)
	if got := allowN(t, l, "ip", 10); got != 2 {
		t.Fatalf("after an hour allowed %d, want burst 2", got)
	}
}

// Entries idle longer than the TTL are dropped, so the map cannot grow with
// every IP that ever connected.
func TestSweepDropsIdleEntries(t *testing.T) {
	l, now := newTestLimiter(60, 5)

	for i := 0; i < 200; i++ {
		l.Allow(string(rune('a'+i%26)) + time.Duration(i).String())
	}
	if l.Len() != 200 {
		t.Fatalf("tracked %d keys, want 200", l.Len())
	}

	*now = now.Add(idleTTL + time.Minute)
	l.Allow("fresh")
	if l.Len() != 1 {
		t.Fatalf("after sweep tracked %d keys, want 1", l.Len())
	}
}

// A recent entry must survive the sweep: pruning is by idleness, not age of
// the limiter.
func TestSweepKeepsActiveEntries(t *testing.T) {
	l, now := newTestLimiter(60, 5)

	l.Allow("active")
	*now = now.Add(sweepInterval) // triggers a sweep, still inside idleTTL
	l.Allow("new-key")
	if l.Len() != 2 {
		t.Fatalf("tracked %d keys, want 2 (active entry was pruned)", l.Len())
	}
}

// Bad config cannot create a limiter that rejects everything.
func TestNewClampsNonsense(t *testing.T) {
	l := New(0, 0)
	if ok, _ := l.Allow("x"); !ok {
		t.Fatal("clamped limiter denied the first request")
	}
}
