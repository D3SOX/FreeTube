<template>
  <div>
    <FtCard class="card">
      <h2>
        <FtIcon
          :icon="['fas', 'info-circle']"
          class="headingIcon"
        />
        {{ $t("About.About") }}
      </h2>
      <section class="brand">
        <FtLogoFull class="logo" />
        <div class="version">
          {{ versionNumber }} {{ $t("About.Beta") }}
        </div>
        <div
          v-if="commitId"
          class="commit"
        >
          {{ commitLabel }}
          <a
            :href="commitUrl"
            :title="buildCommit"
          >{{ commitId }}</a>
        </div>
        <dl
          v-if="runtimeVersions"
          class="runtimeVersions"
        >
          <div
            v-for="runtime in runtimeVersions"
            :key="runtime.name"
            class="runtimeVersion"
          >
            <dt>{{ runtime.name }}</dt>
            <dd>{{ runtime.version }}</dd>
          </div>
        </dl>
      </section>
      <section class="about-chunks">
        <figure
          v-for="chunk in chunks"
          :key="chunk.title"
          class="chunk"
        >
          <FtIcon
            class="icon"
            :icon="chunk.icon"
          />
          <h3 class="title">
            {{ chunk.title }}
          </h3>
          <div
            v-safer-html="chunk.content"
            class="content"
          />
        </figure>
      </section>
    </FtCard>
  </div>
</template>

<script setup>
import { FtIcon } from '@opentubex/icons'
import { computed } from 'vue'
import { useI18n } from 'vue-i18n'

import FtCard from '../../components/ft-card/ft-card.vue'
import FtLogoFull from '../../components/FtLogoFull/FtLogoFull.vue'
import { vSaferHtml } from '../../directives/vSaferHtml.js'
import { getNightlyCommit } from '../../helpers/versionDisplay.js'

import packageDetails from '../../../../package.json'

const { t } = useI18n()

const versionNumber = `v${packageDetails.version}`
const buildCommit = process.env.BUILD_COMMIT
const commitId = getNightlyCommit(packageDetails.version, buildCommit)
const commitLabel = `${t('About.Commit')}:`
const commitUrl = `https://github.com/OpenTubeX/OpenTubeX/commit/${buildCommit}`
const runtimeVersions = process.env.IS_ELECTRON
  ? [
      { name: 'Electron', version: window.ftElectron.runtimeVersions.electron },
      { name: 'Chromium', version: window.ftElectron.runtimeVersions.chromium },
      { name: 'Node.js', version: window.ftElectron.runtimeVersions.node },
      { name: 'V8', version: window.ftElectron.runtimeVersions.v8 }
    ]
  : null

const chunks = computed(() => [
  {
    icon: ['fab', 'github'],
    title: t('About.Source code'),
    content: [
      '<a href="https://github.com/OpenTubeX/OpenTubeX" lang="en" dir="ltr">GitHub: OpenTubeX/OpenTubeX</a>',
      t('About.Licensed under the {licenseLink}', {
        licenseLink: `<a href="https://www.gnu.org/licenses/agpl-3.0.en.html">${t('About.AGPLv3')}</a>`,
      }),
    ].join('<br>'),
  },
  {
    icon: ['fas', 'file-download'],
    title: t('About.Downloads / Changelog'),
    content: `<a href="https://github.com/OpenTubeX/OpenTubeX/releases">${t('About.GitHub releases')}</a>`,
  },
  {
    icon: ['fas', 'question-circle'],
    title: t('About.Help'),
    content: [
      `<a href="https://github.com/OpenTubeX/OpenTubeX/discussions/">${t('About.Discussions')}</a>`,
    ].join(' / '),
  },
  {
    icon: ['fac', 'fluxer'],
    title: t('About.Fluxer'),
    content: '<a href="https://fluxer.opentubex.org">https://fluxer.opentubex.org</a>',
  },
  {
    icon: ['fac', 'matrix'],
    title: t('About.Chat on Matrix'),
    content: '<a href="https://matrix.opentubex.org">#opentubex:matrix.org</a>',
  },
  {
    icon: ['fas', 'exclamation-circle'],
    title: t('About.Report a problem'),
    content: [
      `<a href="https://github.com/OpenTubeX/OpenTubeX/issues">${t('About.GitHub issues')}</a>`,
      t('About.Please check for duplicates before posting'),
    ].join('<br>'),
  },
  {
    icon: ['fas', 'globe'],
    title: t('About.Website'),
    content: '<a href="https://opentubex.org/">https://opentubex.org/</a>',
  },
  {
    icon: ['fas', 'language'],
    title: t('About.Translate'),
    content: '<a href="https://weblate.opentubex.org/engage/opentubex/">https://weblate.opentubex.org/engage/opentubex/</a>',
  },
])
</script>

<style scoped src="./About.css" />
