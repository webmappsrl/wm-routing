import {it, expect} from 'vitest';
import {summarizeDetails} from '../src/details.js';
import {ratingToCai, ratingToCaiMtb, mtbDifficulty} from '../src/difficulty.js';

const rows = {
  11: {cai: 'EE', sac: 'alpine_hiking', origin: 'cai', long_chain: 0, refs: '00;139', rel_ids: '9417478;123',
       cai_mtb: 'BC', cai_mtb_up: 'MC', mtb_scale: '3', mtb_rating: 3, mtb_origin: 'cai_mtb',
       refs_mtb: 'MTB1', rel_ids_mtb: '555'},
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
  expect(r.segments[0].osmWayId).toBe(11);
  expect(r.segments[1].osmWayId).toBe(12);
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

it('espone i segnavia delle relazioni (refs) e null dove mancano', () => {
  const path = {
    points: {coordinates: [[10, 44], [10.001, 44], [10.002, 44]]},
    details: {osm_way_id: [[0, 1, 11], [1, 2, 12]], hike_rating: [[0, 2, 0]]},
  };
  const r = summarizeDetails(path, waysDb);
  expect(r.segments[0].ref).toBe('00;139');
  expect(r.segments[0].relIds).toBe('9417478;123');
  expect(r.segments[1].ref).toBe(null);
  expect(r.segments[1].relIds).toBe(null);
});
it('tabella laterale vecchia, senza la colonna refs: segmenti con ref null', () => {
  const oldDb = {prepare: sql => {
    if (/refs|rel_ids/.test(sql)) throw new Error('no such column');
    return {get: id => ({cai: 'E', sac: null, origin: 'cai', long_chain: 0})};
  }};
  const path = {points: {coordinates: [[10, 44], [10.001, 44]]},
                details: {osm_way_id: [[0, 1, 11]], hike_rating: [[0, 1, 2]]}};
  const old = summarizeDetails(path, oldDb).segments[0];
  expect(old.ref).toBe(null);
  expect(old.relIds).toBe(null);
});

it('ratingToCaiMtb', () => {
  expect(ratingToCaiMtb(1)).toBe('TC');
  expect(ratingToCaiMtb(3)).toBe('BC');
  expect(ratingToCaiMtb(5)).toBe('EC');
  expect(ratingToCaiMtb(0)).toBe(null);
});

it('le due scale restano distinte: nessuna sigla CAI ricavata da mtb:scale', () => {
  expect(mtbDifficulty(3, 'cai_mtb')).toBe('BC');   // la sigla del CAI, riportata
  expect(mtbDifficulty(2, 'mtb_scale')).toBe('S2'); // la Singletrail, nel suo vocabolario
  expect(mtbDifficulty(0, 'mtb_scale')).toBe('S0');
  expect(mtbDifficulty(0, 'none')).toBe(null);
});

const pathMtb = {
  points: {coordinates: [[10, 44], [10.001, 44], [10.002, 44], [10.003, 44]]},
  details: {
    osm_way_id: [[0, 2, 11], [2, 3, 12]],
    hike_rating: [[0, 2, 3], [2, 3, 0]],
    road_class: [[0, 3, 'path']],
    get_off_bike: [[0, 2, true], [2, 3, false]],
  },
};

it('col profilo mtb usa la scala MTB e affianca i segnavia dei due mondi', () => {
  const seg = summarizeDetails(pathMtb, waysDb, 'mtb').segments[0];
  expect(seg.difficulty).toBe('BC');
  expect(seg.origin).toBe('cai_mtb');
  // il numero dipinto sul sasso resta anche quando si pedala
  expect(seg.ref).toBe('00;139');
  expect(seg.refMtb).toBe('MTB1');
  expect(seg.mtbScale).toBe('3');
  expect(seg.caiMtbUp).toBe('MC');
});

it('la difficolta a piedi resta quella di sempre quando il profilo non e mtb', () => {
  const seg = summarizeDetails(pathMtb, waysDb).segments[0];
  expect(seg.difficulty).toBe('EE');
  expect(seg.origin).toBe('cai');
  expect(seg.ref).toBe('00;139');
});

it('il tratto da fare a piedi con la bici porta la condizione accanto al grado', () => {
  const seg = summarizeDetails(pathMtb, waysDb, 'mtb').segments[0];
  expect(seg.difficulty).toBe('BC');
  expect(seg.dismount).toBe(true);
});

it('con una tabella laterale senza colonne MTB non va in errore', () => {
  const oldDb = {prepare: cols => {
    if (cols.includes('mtb_rating')) throw new Error('no such column');
    return {get: id => ({cai: 'EE', sac: null, origin: 'cai', long_chain: 0, refs: '00'})};
  }};
  const seg = summarizeDetails(pathMtb, oldDb, 'mtb').segments[0];
  expect(seg.difficulty).toBe(null);
  expect(seg.origin).toBe('none');
});
