import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import test from 'node:test'

import { selectPullRequests } from '../../_scripts/releaseNotes.mjs'

function withCheckout(callback) {
  const directory = mkdtempSync(path.join(tmpdir(), 'release-notes-selection-'))
  const originalDirectory = process.cwd()
  const source = path.join(directory, 'source')
  const checkout = path.join(directory, 'checkout')
  const git = (...args) => execFileSync('git', args, {
    cwd: source,
    encoding: 'utf8',
    env: {
      ...process.env,
      GIT_AUTHOR_NAME: 'Release notes test',
      GIT_AUTHOR_EMAIL: 'test@example.com',
      GIT_COMMITTER_NAME: 'Release notes test',
      GIT_COMMITTER_EMAIL: 'test@example.com',
    },
    stdio: ['pipe', 'pipe', 'pipe'],
  }).trim()

  try {
    execFileSync('git', ['init', '--quiet', source])
    const tree = git('mktree')
    const commit = (message, parent) => git('commit-tree', tree, '-m', message, ...(parent ? ['-p', parent] : []))
    const previous = commit('Previous release')
    const first = commit('First change', previous)
    const target = commit('Release target', first)
    const unrelated = commit('Another branch', previous)
    git('update-ref', 'refs/heads/development', target)
    git('update-ref', 'refs/heads/other', unrelated)
    git('tag', 'previous', previous)
    git('symbolic-ref', 'HEAD', 'refs/heads/development')
    execFileSync('git', ['clone', '--quiet', '--no-local', source, checkout])

    // GitHub can report a merge that happened after the runner's checkout.
    const later = commit('Merged after checkout', target)
    git('update-ref', 'refs/heads/development', later)
    process.chdir(checkout)
    callback({ previous, first, target, unrelated, later })
  } finally {
    process.chdir(originalDirectory)
    rmSync(directory, { recursive: true, force: true })
  }
}

test('release notes exclude merges after checkout and keep only the release range in order', () => {
  withCheckout(({ previous, first, target, unrelated, later }) => {
    const pullRequest = (oid, number) => ({
      mergeCommit: { oid },
      mergedAt: `2026-09-08T07:30:0${number}Z`,
      number,
    })
    const firstPullRequest = pullRequest(first, 1)
    const targetPullRequest = pullRequest(target, 2)

    assert.deepEqual(selectPullRequests([
      pullRequest(later, 3),
      targetPullRequest,
      pullRequest(previous, 0),
      pullRequest(unrelated, 4),
      { mergeCommit: null },
      firstPullRequest,
    ], 'previous', target), [firstPullRequest, targetPullRequest])
    assert.deepEqual(selectPullRequests([firstPullRequest], 'previous', previous), [])
  })
})

test('release notes still reject invalid release boundaries', () => {
  withCheckout(({ target, unrelated, later }) => {
    assert.throws(() => selectPullRequests([], unrelated, target), /is not an ancestor/)
    assert.throws(() => selectPullRequests([], 'missing-tag', target), /Could not compare Git commits/)
    assert.throws(() => selectPullRequests([], 'previous', later), /Could not compare Git commits/)
  })
})
