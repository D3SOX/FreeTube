import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'
import vm from 'node:vm'

for (const checked of [true, false]) {
  test(`group selection (${checked}) starts a new Shift-click range`, async () => {
    const source = await readFile(new URL('../../src/renderer/components/TabOrganizer/TabOrganizer.vue', import.meta.url), 'utf8')
    const start = source.indexOf('function toggleGroupSelection(')
    const methods = source.slice(start, source.indexOf('function toggleAllTabsSelection(', start))
    const tabs = ['a', 'b', 'c'].map(id => ({ id }))
    const selectedTabIds = { value: new Set(['a']) }
    const context = vm.createContext({
      selectionAnchorId: null,
      selectedTabIds,
      displayedSections: { value: [{ tabs, isCollapsed: false }] },
      normalizedQuery: { value: '' },
      store: {
        dispatch: (action, ids) => {
          assert.equal(action, 'setTabSelection')
          selectedTabIds.value = new Set(ids)
        }
      }
    })
    vm.runInContext(methods, context)
    context.handleTabSelectionClick({ shiftKey: false }, 'a')
    context.toggleGroupSelection({ allTabs: tabs.slice(0, 2) }, checked)
    let prevented = false
    context.handleTabSelectionClick({
      shiftKey: true,
      preventDefault() { prevented = true },
      stopPropagation() {},
      currentTarget: { querySelector: () => null }
    }, 'c')
    assert.equal(prevented, false, 'the first Shift-click after bulk selection should behave like a normal click')
    context.toggleTabSelection('c', true)
    assert.deepEqual([...selectedTabIds.value], checked ? ['a', 'b', 'c'] : ['c'])
  })
}
