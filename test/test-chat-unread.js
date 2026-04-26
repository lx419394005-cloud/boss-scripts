import test from 'node:test';
import assert from 'node:assert/strict';

import { mapChatStoreFriendToUnreadItem, parseArgs, parseUnreadChatItem } from '../index.js';

test('parseArgs reads chat-unread limit', () => {
  const opts = parseArgs(['node', 'boss.js', 'chat-unread', '--limit', '5']);

  assert.equal(opts.cmd, 'chat-unread');
  assert.equal(opts.limit, 5);
});

test('parseUnreadChatItem parses unread list preview text', () => {
  const item = parseUnreadChatItem(
    '1\n22:37\n黄学松深圳市珍艺装饰工程HR\n方便发一份你的简历过来吗？',
    '黄学松',
    '方便发一份你的简历过来吗？'
  );

  assert.deepEqual(item, {
    unread_count: 1,
    time: '22:37',
    boss_name: '黄学松',
    company_and_title: '深圳市珍艺装饰工程HR',
    message: '方便发一份你的简历过来吗？',
  });
});

test('mapChatStoreFriendToUnreadItem maps store friend record', () => {
  const item = mapChatStoreFriendToUnreadItem({
    unreadCount: 2,
    lastTS: Date.parse('2026-04-09T22:37:26+08:00'),
    name: '黄学松',
    brandName: '深圳市珍艺装饰工程',
    title: 'HR',
    lastText: '方便发一份你的简历过来吗？',
    jobName: 'AI Agent 训练师',
    encryptJobId: 'abc',
    securityId: 'sec',
  });

  assert.equal(item.unread_count, 2);
  assert.equal(item.boss_name, '黄学松');
  assert.equal(item.company_and_title, '深圳市珍艺装饰工程 HR');
  assert.equal(item.message, '方便发一份你的简历过来吗？');
  assert.equal(item.job_name, 'AI Agent 训练师');
  assert.equal(item.encrypt_job_id, 'abc');
  assert.equal(item.security_id, 'sec');
});
