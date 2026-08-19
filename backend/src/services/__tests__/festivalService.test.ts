/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * festivalService tests — verify festival detection is date-accurate and
 * deterministic. Covers the reported bug: on 16 Aug 2026 the engine dropped
 * Raksha Bandhan (real date 28 Aug) and reported Janmashtami as "in 10 days"
 * (real date 4 Sep → 19 days).
 */
import { describe, expect, it } from 'vitest';
import { getUpcomingFestivals, getNearestFestival, isFestivalSeason } from '../festivalService';

const AUG_16_2026 = new Date(2026, 7, 16); // local midnight

describe('festivalService — 2026 festival dates', () => {
  it('keeps Raksha Bandhan (28 Aug 2026) as upcoming on 16 Aug 2026', () => {
    const f = getUpcomingFestivals(30, AUG_16_2026).find((x) => x.name === 'Raksha Bandhan');
    expect(f).toBeTruthy();
    expect(f!.date).toBe('2026-08-28');
    expect(f!.daysAway).toBe(12);
  });

  it('reports Janmashtami on 4 Sep 2026 — 19 days away, not 10', () => {
    const f = getUpcomingFestivals(30, AUG_16_2026).find((x) => x.name === 'Janmashtami');
    expect(f).toBeTruthy();
    expect(f!.date).toBe('2026-09-04');
    expect(f!.daysAway).toBe(19);
  });

  it('reports Ganesh Chaturthi on 14 Sep 2026', () => {
    const f = getUpcomingFestivals(30, AUG_16_2026).find((x) => x.name === 'Ganesh Chaturthi');
    expect(f).toBeTruthy();
    expect(f!.date).toBe('2026-09-14');
    expect(f!.daysAway).toBe(29);
  });

  it('suggests combo-style offers for Raksha Bandhan and festival offers for Janmashtami', () => {
    const list = getUpcomingFestivals(30, AUG_16_2026);
    const raksha = list.find((x) => x.name === 'Raksha Bandhan')!;
    const janma = list.find((x) => x.name === 'Janmashtami')!;
    expect(raksha.recommendedOfferTypes).toContain('combo');
    expect(janma.recommendedOfferTypes[0]).toBe('festival');
    expect(janma.foodAngle).toBeTruthy();
  });

  it('sorts upcoming festivals by days away, nearest first', () => {
    const list = getUpcomingFestivals(30, AUG_16_2026);
    for (let i = 1; i < list.length; i++) {
      expect(list[i].daysAway).toBeGreaterThanOrEqual(list[i - 1].daysAway);
    }
  });

  it('reports Raksha Bandhan as "today" on 28 Aug 2026', () => {
    const list = getUpcomingFestivals(30, new Date(2026, 7, 28));
    const raksha = list.find((x) => x.name === 'Raksha Bandhan')!;
    expect(raksha.daysAway).toBe(0);
  });
});

describe('festivalService — rollover & fixed dates', () => {
  it('rolls a passed 2026 Holi to 2027-03-22', () => {
    const f = getUpcomingFestivals(400, AUG_16_2026).find((x) => x.name === 'Holi');
    expect(f).toBeTruthy();
    expect(f!.date).toBe('2027-03-22');
  });

  it('keeps fixed-date Independence Day on 15 Aug', () => {
    const f = getUpcomingFestivals(30, new Date(2026, 7, 10)).find((x) => x.name === 'Independence Day');
    expect(f!.date).toBe('2026-08-15');
    expect(f!.daysAway).toBe(5);
  });

  it('computes Mother\'s Day as the 2nd Sunday of May (2026-05-10)', () => {
    const f = getUpcomingFestivals(60, new Date(2026, 3, 1)).find((x) => x.name === "Mother's Day");
    expect(f).toBeTruthy();
    expect(f!.date).toBe('2026-05-10');
    expect(f!.daysAway).toBe(39);
  });

  it('computes Friendship Day as the 1st Sunday of August (2026-08-02)', () => {
    const f = getUpcomingFestivals(60, new Date(2026, 6, 1)).find((x) => x.name === 'Friendship Day');
    expect(f).toBeTruthy();
    expect(f!.date).toBe('2026-08-02');
  });
});

describe('festivalService — fallback & helpers', () => {
  it('falls back to approximate dates for years outside the exact table without crashing', () => {
    // 15 Jun 2030 — Diwali (approx 20 Oct) is ~4 months out, so use a wide window.
    const list = getUpcomingFestivals(200, new Date(2030, 5, 15));
    const diwali = list.find((x) => x.name === 'Diwali');
    expect(diwali).toBeTruthy();
    expect(diwali!.date).toBe('2030-10-20');
    expect(diwali!.daysAway).toBeGreaterThanOrEqual(0);
  });

  it('getNearestFestival returns the earliest upcoming festival', () => {
    const nearest = getNearestFestival();
    expect(nearest).toBeTruthy();
    const first = getUpcomingFestivals(60)[0];
    expect(nearest!.name).toBe(first.name);
  });

  it('isFestivalSeason(7) returns null when no festival is within 7 days', () => {
    // 16 Jul 2026 — Raksha Bandhan (28 Aug) and Onam (26 Aug) are weeks away.
    const season = isFestivalSeason(7, new Date(2026, 6, 16));
    // When nothing is near, the service returns null (no festival in window).
    expect(season).toBeNull();
  });
});
