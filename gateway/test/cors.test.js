import {it, expect} from 'vitest';
import {corsHeaders} from '../src/cors.js';

const shard = {origins: ['https://parco-x.it']};
it("un'origine in lista riceve le intestazioni", () => {
  expect(corsHeaders(shard, 'https://parco-x.it')['Access-Control-Allow-Origin']).toBe('https://parco-x.it');
});
it("un'origine fuori lista non le riceve", () => {
  expect(corsHeaders(shard, 'https://altro.it')).toBeNull();
});
it('senza Origin (un programma) niente intestazioni', () => {
  expect(corsHeaders(shard, undefined)).toBeNull();
});
