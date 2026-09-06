import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'
import vm from 'node:vm'
import { computed, ref } from 'vue'

import { isRoundedNumber } from '../../src/renderer/helpers/viewCounts.js'

// Exercise the component's computed count and actual formatter without loading
// the renderer's browser-only imports.
const component = await readFile(new URL('../../src/renderer/components/CommentSection/CommentSection.vue', import.meta.url), 'utf8')
const utils = await readFile(new URL('../../src/renderer/helpers/utils.js', import.meta.url), 'utf8')
const formatterStart = utils.indexOf('export function formatViewCount(')
const formatter = utils.slice(formatterStart + 'export '.length, utils.indexOf('\n}\n', formatterStart) + 2)
const countStart = component.indexOf('const formattedCommentCount = computed(')
const countSource = component.slice(countStart, component.indexOf('\nwatch(', countStart))

function commentHeader(count, locale = 'en') {
  const commentCount = ref(count)
  const shortenViewCounts = ref(true)
  const header = vm.runInNewContext(`${formatter}\n${countSource}\n;({ formattedCommentCount, commentsTitle })`, {
    computed,
    commentCount,
    shortenViewCounts,
    isRoundedNumber,
    formatNumber: (number, options) => new Intl.NumberFormat(locale, options).format(number),
    t: (key, values, plural) => ({ key, count: values?.count, plural })
  })
  return { ...header, commentCount, shortenViewCounts }
}

test('rounded comment totals follow the shortening setting reactively', () => {
  const header = commentHeader(3500000)
  assert.equal(header.formattedCommentCount.value, '3.5M')
  assert.equal(header.commentsTitle.value.count, '3.5M')
  assert.equal(header.commentsTitle.value.plural, 3500000)

  header.shortenViewCounts.value = false
  assert.equal(header.formattedCommentCount.value, '3,500,000')
  header.shortenViewCounts.value = true
  assert.equal(header.formattedCommentCount.value, '3.5M')
  header.commentCount.value = 14000
  assert.equal(header.formattedCommentCount.value, '14K')
})

test('exact comment totals retain every digit', () => {
  for (const count of [1234567, 4321, 1050000, 999, 1, 0]) {
    const header = commentHeader(count)
    assert.equal(header.formattedCommentCount.value, new Intl.NumberFormat('en').format(count))
    assert.equal(header.commentsTitle.value.plural, count)
  }
})

test('rounded comment totals use the active locale', () => {
  assert.equal(commentHeader(3500000, 'de').formattedCommentCount.value, '3,5\u00a0Mio.')
})

test('unknown comment totals retain the generic comments heading', () => {
  const header = commentHeader(null)
  assert.equal(header.formattedCommentCount.value, '')
  assert.equal(header.commentsTitle.value.key, 'Comments.Comments')
})
