import test from 'node:test';
import assert from 'node:assert/strict';

import {
  buildBossDetailUrl,
  extractBossDetailSeedFromScript,
  buildBossJobFromDetailUrl,
  parseArgs,
  MIN_BOSS_ACCESS_INTERVAL_MS,
} from '../index.js';

test('parseArgs reads jd-open url', () => {
  const opts = parseArgs(['node', 'boss.js', 'jd-open', '--url', 'https://www.zhipin.com/job_detail/abc.html']);

  assert.equal(opts.cmd, 'jd-open');
  assert.equal(opts.url, 'https://www.zhipin.com/job_detail/abc.html');
});

test('buildBossJobFromDetailUrl parses job detail url and optional params', () => {
  const job = buildBossJobFromDetailUrl('https://www.zhipin.com/job_detail/abc123.html?securityId=s1&lid=l2');

  assert.deepEqual(job, {
    id: 'abc123',
    security_id: 's1',
    lid: 'l2',
    job_url: 'https://www.zhipin.com/job_detail/abc123.html?securityId=s1&lid=l2',
    title: '',
    company: '',
  });
});

test('buildBossDetailUrl prefers securityId and keeps lid when present', () => {
  const url = buildBossDetailUrl({
    id: 'abc123',
    security_id: 's1',
    lid: 'l2',
  });

  assert.equal(
    url,
    'https://www.zhipin.com/wapi/zpgeek/job/detail.json?securityId=s1&lid=l2'
  );
});

test('extractBossDetailSeedFromScript reads embedded _jobInfo fields', () => {
  const seed = extractBossDetailSeedFromScript(`
    var _jobInfo = {
      job_id: 'abc123',
      job_name: 'AI Agent工程师',
      company:'观麦',
      securityId:'sec-1',
      lid:'lid-2',
    };
  `);

  assert.deepEqual(seed, {
    id: 'abc123',
    security_id: 'sec-1',
    title: 'AI Agent工程师',
    company: '观麦',
    lid: 'lid-2',
  });
});

test('boss access interval remains at least 10 seconds', () => {
  assert.equal(MIN_BOSS_ACCESS_INTERVAL_MS, 10000);
});
