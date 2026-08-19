import { useMemo } from 'react'
import { CaretDown, Check, Plus, SquaresFour, Star } from '@phosphor-icons/react'
import { DropdownMenu } from '@cloudflare/kumo'
import type { GadgetMetadataWithTimestamps } from '@gadgets/workshop-shared/api'
import { logRpcFailure } from '../rpcErrors'

/** Sentinel value for starting a chat in a freshly created workspace. */
export const NEW_WORKSPACE_TARGET = 'new' as const

export type HomeWorkspaceTarget = typeof NEW_WORKSPACE_TARGET | string

type Props = {
  workspaces: GadgetMetadataWithTimestamps[]
  loading: boolean
  value: HomeWorkspaceTarget
  onChange: (target: HomeWorkspaceTarget) => void
}

function sortWorkspaces(workspaces: GadgetMetadataWithTimestamps[]) {
  const favorites: GadgetMetadataWithTimestamps[] = []
  const recent: GadgetMetadataWithTimestamps[] = []
  for (const workspace of workspaces) {
    if (workspace.pinned) favorites.push(workspace)
    else recent.push(workspace)
  }
  const byActive = (a: GadgetMetadataWithTimestamps, b: GadgetMetadataWithTimestamps) =>
    b.lastActive.getTime() - a.lastActive.getTime()
  favorites.sort(byActive)
  recent.sort(byActive)
  return { favorites, recent }
}

function workspaceLabel(workspace: GadgetMetadataWithTimestamps) {
  return workspace.title.trim() || 'Untitled Workspace'
}

export function loadHomeWorkspaces(
  listGadgets: () => Promise<GadgetMetadataWithTimestamps[]>,
): Promise<GadgetMetadataWithTimestamps[]> {
  return listGadgets().catch((err) => {
    logRpcFailure('Failed to load workspaces for home:', err)
    return []
  })
}

export default function HomeWorkspaceSelector({ workspaces, loading, value, onChange }: Props) {
  const { favorites, recent } = useMemo(() => sortWorkspaces(workspaces), [workspaces])
  const selectedWorkspace = value === NEW_WORKSPACE_TARGET
    ? null
    : workspaces.find((workspace) => workspace.id === value) ?? null

  const triggerLabel = selectedWorkspace
    ? workspaceLabel(selectedWorkspace)
    : 'New workspace'

  return (
    <div className="flex justify-center">
      <DropdownMenu>
        <DropdownMenu.Trigger
          render={
            <button
              type="button"
              disabled={loading && workspaces.length === 0}
              className="group inline-flex h-9 max-w-full cursor-pointer items-center gap-2 rounded-xl border border-kumo-line/70 bg-kumo-base/80 px-3 text-[13px] leading-5 tracking-[-0.25px] text-kumo-subtle shadow-sm backdrop-blur-sm transition-[background-color,color,transform,border-color] duration-150 ease-out hover:border-kumo-line hover:bg-kumo-base hover:text-kumo-default focus-visible:border-kumo-line focus-visible:bg-kumo-base focus-visible:text-kumo-default focus-visible:outline-none active:scale-[0.98] disabled:cursor-default disabled:opacity-60 data-[popup-open]:border-kumo-line data-[popup-open]:bg-kumo-base data-[popup-open]:text-kumo-default"
              aria-label="Choose workspace for new chat"
            >
              {selectedWorkspace ? (
                <SquaresFour size={15} className="flex-shrink-0 text-kumo-inactive" />
              ) : (
                <Plus size={15} className="flex-shrink-0 text-kumo-inactive" />
              )}
              <span className="min-w-0 truncate">{loading ? 'Loading workspaces…' : triggerLabel}</span>
              <CaretDown
                size={12}
                weight="bold"
                className="flex-shrink-0 text-kumo-inactive transition-transform duration-150 ease-out group-data-[popup-open]:rotate-180"
              />
            </button>
          }
        />
        <DropdownMenu.Content
          collisionPadding={16}
          className="themed-floating-shadow-lg !z-[1100] !max-h-[min(360px,60vh)] !min-w-[240px] overflow-y-auto rounded-2xl border border-kumo-line/70 bg-kumo-base p-1"
        >
          <DropdownMenu.Item
            onClick={() => onChange(NEW_WORKSPACE_TARGET)}
            className="!h-auto rounded-xl !px-2 !py-1.5 text-[12px] leading-4 font-normal tracking-[-0.15px] text-kumo-subtle transition-colors data-highlighted:bg-kumo-tint/70 data-highlighted:text-kumo-default"
          >
            <span className="mr-2 inline-flex h-4 w-4 items-center justify-center text-kumo-inactive">
              <Plus size={14} />
            </span>
            <span className="min-w-0 flex-1 truncate">New workspace</span>
            {value === NEW_WORKSPACE_TARGET && (
              <Check size={12} weight="bold" className="ml-3 flex-shrink-0 text-kumo-inactive" />
            )}
          </DropdownMenu.Item>

          {favorites.length > 0 && (
            <>
              <div className="px-2 pt-2 pb-1 text-[10px] font-medium uppercase tracking-[0.08em] text-kumo-inactive">
                Favorites
              </div>
              {favorites.map((workspace) => (
                <WorkspaceMenuItem
                  key={workspace.id}
                  workspace={workspace}
                  active={value === workspace.id}
                  onSelect={() => onChange(workspace.id)}
                />
              ))}
            </>
          )}

          {recent.length > 0 && (
            <>
              <div className="px-2 pt-2 pb-1 text-[10px] font-medium uppercase tracking-[0.08em] text-kumo-inactive">
                {favorites.length > 0 ? 'Recent' : 'Workspaces'}
              </div>
              {recent.map((workspace) => (
                <WorkspaceMenuItem
                  key={workspace.id}
                  workspace={workspace}
                  active={value === workspace.id}
                  onSelect={() => onChange(workspace.id)}
                />
              ))}
            </>
          )}
        </DropdownMenu.Content>
      </DropdownMenu>
    </div>
  )
}

function WorkspaceMenuItem({
  workspace,
  active,
  onSelect,
}: {
  workspace: GadgetMetadataWithTimestamps
  active: boolean
  onSelect: () => void
}) {
  return (
    <DropdownMenu.Item
      onClick={onSelect}
      className="!h-auto rounded-xl !px-2 !py-1.5 text-[12px] leading-4 font-normal tracking-[-0.15px] text-kumo-subtle transition-colors data-highlighted:bg-kumo-tint/70 data-highlighted:text-kumo-default"
    >
      <span className="mr-2 inline-flex h-4 w-4 items-center justify-center text-kumo-inactive">
        {workspace.pinned ? <Star size={14} weight="fill" /> : <SquaresFour size={14} />}
      </span>
      <span className="min-w-0 flex-1 truncate">{workspaceLabel(workspace)}</span>
      {active && (
        <Check size={12} weight="bold" className="ml-3 flex-shrink-0 text-kumo-inactive" />
      )}
    </DropdownMenu.Item>
  )
}
