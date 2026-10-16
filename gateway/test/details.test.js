import {it, expect} from 'vitest';
import {summarizeDetails} from '../src/details.js';
import {ratingToCai} from '../src/difficulty.js';

const rows = {
  11: {cai: 'EE', sac: 'alpine_hiking', origin: 'cai', long_chain: 0},
  12: {cai: null, sac: null, origin: 'none', long_chain: 1},
};
const waysDb = {prepare: () => ({get: id => rows[id]})};

it('ratingToCai', () => {
  expect(ratingToCai(3)).toBe('EE');
  expect(ratingToCai(6, 'sac')).toBe('EEA');
  expect(ratingToCai(6, 'glacier')).toBe('ghiacciaio');
  expect(ratingToCai(6, 'via_ferrata')).toBe('via ferrata');
  expect(ratingToCai(0)).toBe(null);
});

it('unisce i dettagli del motore e la tabella laterale, senza esporre horse_rating', () => {
  const path = {
    points: {coordinates: [[10, 44], [10.001, 44], [10.002, 44], [10.003, 44]]},
    details: {
      osm_way_id: [[0, 2, 11], [2, 3, 12]],
      hike_rating: [[0, 2, 3], [2, 3, 0]],
      surface: [[0, 3, 'missing']],
      foot_network: [[0, 2, 'local'], [2, 3, 'missing']],
      average_slope: [[0, 3, 4]],
      road_environment: [[0, 2, 'road'], [2, 3, 'ford']],
      road_class: [[0, 3, 'path']],
      get_off_bike: [[0, 3, false]],
    },
  };
  const r = summarizeDetails(path, waysDb);
  expect(r.segments[1].ford).toBe(true);
  expect(r.segments[0].ford).toBe(false);
  expect(r.segments[0].dismount).toBe(false);
  expect(r.segments[0]).toMatchObject({from: 0, to: 2, difficulty: 'EE', origin: 'cai', sac: 'alpine_hiking', longChain: false});
  expect(r.segments[1]).toMatchObject({from: 2, to: 3, difficulty: null, origin: 'none', longChain: true});
  expect(JSON.stringify(r)).not.toContain('horse');
  expect(r.unknownShare).toBeCloseTo(1 / 3, 2);
});

it("la difficolta' sconosciuta conta solo sui sentieri, non su strade e forestali", () => {
  const path = {
    points: {coordinates: [[10, 44], [10.001, 44], [10.002, 44]]},
    details: {
      osm_way_id: [[0, 1, 12], [1, 2, 12]],
      hike_rating: [[0, 2, 0]],
      road_class: [[0, 1, 'track'], [1, 2, 'path']],
    },
  };
  const r = summarizeDetails(path, waysDb);
  expect(r.unknownShare).toBeCloseTo(0.5, 2);
  expect(r.segments[0].roadClass).toBe('track');
});
