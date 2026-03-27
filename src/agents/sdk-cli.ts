#!/usr/bin/env node
/**
 * anc-sdk CLI — wrapper around the typed SDK.
 * This is what agents call from their tmux sessions.
 */

import { Command } from 'commander';
import * as sdk from './sdk.js';

const program = new Command();

program
  .name('anc')
  .description('ANC Agent SDK — interact with Linear and other agents')
  .version('0.1.0');

program
  .command('comment <issue-key> <body>')
  .description('Post a comment on an issue')
  .action(async (key: string, body: string) => {
    await sdk.comment(key, body);
  });

program
  .command('dispatch <role> <issue-key> [context]')
  .description('Start another agent on an issue')
  .action(async (role: string, key: string, context?: string) => {
    await sdk.dispatch(role, key, context);
  });

program
  .command('handoff <role> <issue-key> <context>')
  .description('Sequential handoff: you finish, target continues')
  .action(async (role: string, key: string, context: string) => {
    await sdk.handoff(role, key, context);
  });

program
  .command('ask <role> <issue-key> <question>')
  .description('Ask another agent a question (async)')
  .action(async (role: string, key: string, question: string) => {
    await sdk.ask(role, key, question);
  });

program
  .command('status <issue-key> <status>')
  .description('Change issue status (Backlog, Todo, In Progress, In Review, Done, Canceled)')
  .action(async (key: string, status: string) => {
    await sdk.setStatus(key, status);
  });

program
  .command('create-sub <parent-key> <title> [description]')
  .description('Create a sub-issue (always linked to parent)')
  .option('-p, --priority <n>', 'Priority: 1=Urgent, 2=High, 3=Normal, 4=Low', '3')
  .action(async (parentKey: string, title: string, description?: string, opts?: { priority: string }) => {
    await sdk.createSub(parentKey, title, description ?? '', Number(opts?.priority ?? 3));
  });

program
  .command('team-status')
  .description('Show who is working on what')
  .action(async () => {
    await sdk.teamStatus();
  });

program
  .command('group <message>')
  .description('Post to company Discord')
  .action(async (message: string) => {
    await sdk.group(message);
  });

program
  .command('plan <text>')
  .description('Announce your plan to Discord (bridge-aware)')
  .action(async (text: string) => {
    await sdk.plan(text);
  });

program
  .command('reply <issue-key> <comment-id> <body>')
  .description('Reply to a specific comment (threaded)')
  .action(async (key: string, commentId: string, body: string) => {
    await sdk.reply(key, commentId, body);
  });

program
  .command('search <query>')
  .description('Search issues by text')
  .action(async (query: string) => {
    await sdk.search(query);
  });

program
  .command('list-issues [status]')
  .description('List issues, optionally filtered by status')
  .action(async (status?: string) => {
    await sdk.listIssues(status);
  });

// Error handling
program.hook('postAction', () => process.exit(0));

program.parseAsync(process.argv).catch(err => {
  console.error(`Error: ${err.message}`);
  process.exit(1);
});
