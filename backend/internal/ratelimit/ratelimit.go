// Package ratelimit is a per-key token bucket for the public HTTP surface.
//
// /api/status is public and each cold call reads up to twelve SQLite files, so
// one noisy client (or a loop with no backoff) can starve every other viewer.
// The bucket is deliberately in-memory and dependency-free: the office runs as
// a single process, and a limit that survives a restart is not worth a store.
package ratelimit

import (
	"math"
	"sync"
	"time"
)

const (
	// sweepInterval bounds how often Allow scans the map for idle keys. A scrub
	// per request would turn every call into an O(n) walk under the same mutex.
	sweepInterval = time.Minute
	// idleTTL is how long a key survives without a request. Deleting an idle
	// bucket is always safe: a fresh bucket starts full, which is at least as
	// generous as the refilled one it replaces.
	idleTTL = 3 * time.Minute
)

type bucket struct {
	tokens float64
	last   time.Time
}

// Limiter is safe for concurrent use.
type Limiter struct {
	mu      sync.Mutex
	rate    float64 // tokens per second
	burst   float64
	buckets map[string]*bucket
	clock   func() time.Time

	lastSweep time.Time
}

// New builds a limiter that refills perMin tokens over a minute and allows a
// burst of burst tokens after an idle period. Non-positive inputs are clamped
// to 1 so a bad env value cannot produce a division by zero.
func New(perMin, burst int) *Limiter {
	if perMin < 1 {
		perMin = 1
	}
	if burst < 1 {
		burst = 1
	}
	return &Limiter{
		rate:    float64(perMin) / 60,
		burst:   float64(burst),
		buckets: map[string]*bucket{},
		clock:   time.Now,
	}
}

// Allow takes one token for key. When the bucket is empty it reports false and
// how long the caller should wait before retrying.
func (l *Limiter) Allow(key string) (bool, time.Duration) {
	now := l.clock()

	l.mu.Lock()
	defer l.mu.Unlock()

	if now.Sub(l.lastSweep) >= sweepInterval {
		l.sweepLocked(now)
		l.lastSweep = now
	}

	b := l.buckets[key]
	if b == nil {
		b = &bucket{tokens: l.burst, last: now}
		l.buckets[key] = b
	}
	if elapsed := now.Sub(b.last).Seconds(); elapsed > 0 {
		b.tokens = math.Min(l.burst, b.tokens+elapsed*l.rate)
	}
	b.last = now

	if b.tokens >= 1 {
		b.tokens--
		return true, 0
	}
	wait := time.Duration(math.Ceil((1-b.tokens)/l.rate)) * time.Second
	if wait < time.Second {
		wait = time.Second
	}
	return false, wait
}

// Len is the number of tracked keys; tests use it to prove the sweep works.
func (l *Limiter) Len() int {
	l.mu.Lock()
	defer l.mu.Unlock()
	return len(l.buckets)
}

func (l *Limiter) sweepLocked(now time.Time) {
	for k, b := range l.buckets {
		if now.Sub(b.last) >= idleTTL {
			delete(l.buckets, k)
		}
	}
}
