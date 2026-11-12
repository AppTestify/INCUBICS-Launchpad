<!--
// Copyright © 2026 INCUBICS.
//
// Licensed under the Eclipse Public License, Version 2.0 (the "License");
// you may not use this file except in compliance with the License. You may
// obtain a copy of the License at https://www.eclipse.org/legal/epl-2.0
//
// Unless required by applicable law or agreed to in writing, software
// distributed under the License is distributed on an "AS IS" BASIS,
// WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
//
// See the License for the specific language governing permissions and
// limitations under the License.
-->
<script lang="ts">
  import attachment, { type Attachment } from '@hcengineering/attachment'
  import { AttachmentsGalleryView, AttachmentsListView } from '@hcengineering/attachment-resources'
  import { type Ref, SortingOrder, type Space, type WithLookup } from '@hcengineering/core'
  import { createQuery } from '@hcengineering/presentation'
  import { Label, Loading, Scroller, SearchInput, TabList } from '@hcengineering/ui'
  import view from '@hcengineering/view'

  // Every file shared in this channel or direct conversation, newest first.
  export let space: Ref<Space>

  const FILES_LIMIT = 500

  const query = createQuery()

  let files: Array<WithLookup<Attachment>> = []
  let loading = true
  let search = ''
  let isListMode = true

  $: loadFiles(space, search)

  function loadFiles (space: Ref<Space>, search: string): void {
    loading = true
    const name = search.trim()
    query.query(
      attachment.class.Attachment,
      { space, ...(name !== '' ? { name: { $like: `%${name}%` } } : {}) },
      (res) => {
        files = res
        loading = false
      },
      { sort: { modifiedOn: SortingOrder.Descending }, limit: FILES_LIMIT }
    )
  }
</script>

<div class="files-toolbar">
  <SearchInput
    value={search}
    width="16rem"
    on:change={(ev) => {
      search = ev.detail ?? ''
    }}
  />
  <TabList
    items={[
      { id: 'list', icon: view.icon.Table },
      { id: 'grid', icon: view.icon.Card }
    ]}
    selected={isListMode ? 'list' : 'grid'}
    on:select={(result) => {
      if (result.detail !== undefined) isListMode = result.detail.id === 'list'
    }}
  />
</div>
<div class="files-body">
  {#if loading}
    <Loading />
  {:else if files.length > 0}
    <Scroller padding="0.5rem 0 1rem 0.5rem">
      {#if isListMode}
        <AttachmentsListView attachments={files} />
      {:else}
        <AttachmentsGalleryView attachments={files} />
      {/if}
    </Scroller>
  {:else}
    <div class="files-empty">
      <Label label={attachment.string.NoFiles} />
    </div>
  {/if}
</div>

<style lang="scss">
  .files-toolbar {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 1rem;
    flex-shrink: 0;
    padding: 0.5rem 1rem;
    border-bottom: 1px solid var(--theme-divider-color);
  }
  .files-body {
    display: flex;
    flex-direction: column;
    flex-grow: 1;
    min-height: 0;
    height: 100%;
  }
  .files-empty {
    padding: 1.5rem;
    color: var(--theme-dark-color);
  }
</style>
