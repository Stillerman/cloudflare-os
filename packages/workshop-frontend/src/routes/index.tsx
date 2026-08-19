import { classifyRpcError, logRpcFailure } from "../rpcErrors";
import { useState, useEffect, useRef, useCallback } from "react";
import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useKumoToastManager } from "@cloudflare/kumo";
import { RpcStub, RpcTarget } from "capnweb";
import { ChatInput } from "../ChatInterface";
import MeshBackground from "../components/MeshBackground";
import HomeTaskSuggestions from "../components/AppShell/HomeTaskSuggestions";
import HomeWorkspaceSelector, {
  loadHomeWorkspaces,
  NEW_WORKSPACE_TARGET,
  type HomeWorkspaceTarget,
} from "../components/HomeWorkspaceSelector";
import ObserverConfigModal from "../ObserverConfigModal";
import { useAuthenticatedApi } from "../AuthContext";
import {
  Overseer,
  AiChatAuthorInfo,
  CapsuleSpecifier,
  ChatAttachmentHandle,
  MessageFormatRef,
  SlashCommandRequest,
  GadgetMetadataWithTimestamps,
  ObserverBindingNeed,
  ObserverAccountChoice,
  ObserverConfigCallback,
  getOpenGadgetErrorCode,
  OPEN_GADGET_ERROR_CODES,
} from "@gadgets/workshop-shared/api";
import {
  getStoredSelectedModel,
  persistSelectedModel,
} from "../modelSelection";
import { useDocumentTitle } from "../useDocumentTitle";
import { homePromptFromSearch } from "../homePrompt";
import { composerDraftStorageKey } from "../composerDraft";

type HomeSearch = { prompt?: string };

export const Route = createFileRoute("/")({
  component: HomePage,
  validateSearch: (search: Record<string, unknown>): HomeSearch => ({
    prompt: homePromptFromSearch(search.prompt),
  }),
});

type OverseerSession = {
  stub: RpcStub<Overseer>;
  kind: "new" | "existing";
  workspaceId?: string;
  configureObservers?: RpcStub<ObserverConfigCallback>;
};

type ObserverConfigState = {
  needs: ObserverBindingNeed[];
  resolve: (choices: ObserverAccountChoice[]) => void;
  reject: (error: unknown) => void;
};

// The Home page is the chat launcher. Persistent navigation (recents, favorites) lives in the
// AppShell rail; this page focuses on composing the first message of a new chat — in a new
// workspace or an existing one.
function HomePage() {
  return <HomePageContent prompt={Route.useSearch().prompt} />;
}

export function HomePageContent({ prompt }: HomeSearch) {
  useDocumentTitle("Home");

  const { authenticatedApi, currentUser } = useAuthenticatedApi();
  const navigate = useNavigate();
  const toasts = useKumoToastManager();

  const [models, setModels] = useState<AiChatAuthorInfo[]>([]);
  const [selectedModel, setSelectedModel] = useState<string | null>(null);
  const [workspaces, setWorkspaces] = useState<GadgetMetadataWithTimestamps[]>([]);
  const [workspacesLoading, setWorkspacesLoading] = useState(true);
  const [workspaceTarget, setWorkspaceTarget] = useState<HomeWorkspaceTarget>(
    NEW_WORKSPACE_TARGET,
  );
  const [observerConfig, setObserverConfig] = useState<ObserverConfigState | null>(null);
  // Bumped each time a task suggestion is picked; the composer re-seeds its text off the nonce.
  const [seed, setSeed] = useState<{ text: string; nonce: number } | null>(null);

  useEffect(() => {
    if (!prompt) return;
    setSeed((previous) => ({ text: prompt, nonce: (previous?.nonce ?? 0) + 1 }));
    navigate({ to: "/", search: {}, replace: true });
  }, [navigate, prompt]);

  useEffect(() => {
    let cancelled = false;
    authenticatedApi.listModels()
      .then((list) => {
        if (cancelled) return;
        setModels(list);
        setSelectedModel(getStoredSelectedModel(list));
      })
      .catch((err) => {
        logRpcFailure("Failed to fetch models:", err);
        // Toast unless it's a connection error (reconnect refetches); a do-reset here already
        // survived the Worker's same-colo retry, so the user should hear about it.
        if (classifyRpcError(err) !== "connection") {
          toasts.add({ title: "Couldn't load AI models", variant: "error" });
        }
      });
    return () => {
      cancelled = true;
    };
  }, [authenticatedApi]);

  useEffect(() => {
    let cancelled = false;
    setWorkspacesLoading(true);
    loadHomeWorkspaces(() => authenticatedApi.listGadgets())
      .then((list) => {
        if (cancelled) return;
        setWorkspaces(list);
        setWorkspacesLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [authenticatedApi]);

  const handleModelChange = useCallback((value: string | null) => {
    setSelectedModel(value);
    persistSelectedModel(value);
  }, []);

  const handleWorkspaceTargetChange = useCallback((target: HomeWorkspaceTarget) => {
    setWorkspaceTarget(target);
  }, []);

  const overseerSessionRef = useRef<OverseerSession | null>(null);
  const workspaceTargetRef = useRef(workspaceTarget);
  workspaceTargetRef.current = workspaceTarget;
  const pendingObserverRejectRef = useRef<((error: unknown) => void) | null>(null);

  const disposeOverseerSession = useCallback(() => {
    overseerSessionRef.current?.configureObservers?.[Symbol.dispose]();
    overseerSessionRef.current?.stub[Symbol.dispose]();
    overseerSessionRef.current = null;
  }, []);

  useEffect(() => {
    return () => {
      if (pendingObserverRejectRef.current) {
        pendingObserverRejectRef.current(new Error("Cancelled"));
        pendingObserverRejectRef.current = null;
      }
      setObserverConfig(null);
      disposeOverseerSession();
    };
  }, [disposeOverseerSession]);

  // Drop any cached overseer when the target workspace changes.
  useEffect(() => {
    disposeOverseerSession();
  }, [workspaceTarget, disposeOverseerSession]);

  const openExistingWorkspace = useCallback(async (workspaceId: string): Promise<{
    stub: RpcStub<Overseer>;
    configureObservers: RpcStub<ObserverConfigCallback>;
  }> => {
    const configureObserversTarget = new (class extends RpcTarget implements ObserverConfigCallback {
      configure(needs: ObserverBindingNeed[]): Promise<ObserverAccountChoice[]> {
        return new Promise<ObserverAccountChoice[]>((resolve, reject) => {
          pendingObserverRejectRef.current = reject;
          setObserverConfig({
            needs,
            resolve: (choices) => {
              pendingObserverRejectRef.current = null;
              setObserverConfig(null);
              resolve(choices);
            },
            reject: (error) => {
              pendingObserverRejectRef.current = null;
              setObserverConfig(null);
              reject(error);
            },
          });
        });
      }
    })();
    const configureObservers = new RpcStub(configureObserversTarget);
    try {
      const stub = await authenticatedApi.openGadget(workspaceId, undefined, configureObservers);
      return { stub, configureObservers };
    } catch (error) {
      configureObservers[Symbol.dispose]();
      throw error;
    }
  }, [authenticatedApi]);

  const ensureOverseer = useCallback(async (): Promise<RpcStub<Overseer>> => {
    const target = workspaceTargetRef.current;
    const current = overseerSessionRef.current;

    if (target === NEW_WORKSPACE_TARGET) {
      if (current?.kind === "new") return current.stub;
      disposeOverseerSession();
      const stub = authenticatedApi.newGadget();
      overseerSessionRef.current = { stub, kind: "new" };
      return stub;
    }

    if (current?.kind === "existing" && current.workspaceId === target) {
      return current.stub;
    }

    disposeOverseerSession();
    const { stub, configureObservers } = await openExistingWorkspace(target);
    overseerSessionRef.current = {
      stub,
      kind: "existing",
      workspaceId: target,
      configureObservers,
    };
    return stub;
  }, [authenticatedApi, disposeOverseerSession, openExistingWorkspace]);

  const handleSend = useCallback(
    async (
      message: string | SlashCommandRequest,
      modelId: string | null,
      capsules?: CapsuleSpecifier[],
      attachments?: ChatAttachmentHandle[],
      formats?: MessageFormatRef[],
    ) => {
      const creatingNewWorkspace = workspaceTargetRef.current === NEW_WORKSPACE_TARGET;
      try {
        const overseer = await ensureOverseer();
        if (creatingNewWorkspace) {
          const [chat, { id }] = await Promise.all([
            overseer.newChat(message, modelId, capsules, attachments, formats),
            overseer.getMetadata(),
          ]);
          disposeOverseerSession();
          navigate({ to: "/workspace/$id", params: { id }, search: { chat } });
        } else {
          const workspaceId = workspaceTargetRef.current;
          const chat = await overseer.newChat(message, modelId, capsules, attachments, formats);
          disposeOverseerSession();
          navigate({ to: "/workspace/$id", params: { id: workspaceId }, search: { chat } });
        }
      } catch (err) {
        const transient = logRpcFailure(
          creatingNewWorkspace ? "Failed to create workspace:" : "Failed to start chat:",
          err,
          { reportSite: creatingNewWorkspace ? "workspace.create" : "chat.new" },
        );
        // A retry reuses the overseer while the draft contains gadget-scoped references.
        if (!attachments?.length && !capsules?.length) {
          disposeOverseerSession();
        }
        if (!transient) {
          if (creatingNewWorkspace) {
            toasts.add({ title: "Failed to create workspace", variant: "error" });
          } else {
            const code = getOpenGadgetErrorCode(err);
            const title = code === OPEN_GADGET_ERROR_CODES.workspaceNotFound
              ? "Workspace not found"
              : code === OPEN_GADGET_ERROR_CODES.workspaceAccessDenied
                ? "You don't have access to this workspace"
                : "Failed to start chat";
            toasts.add({ title, variant: "error" });
          }
        }
        throw err;
      }
    },
    [ensureOverseer, disposeOverseerSession, navigate, toasts],
  );

  const getOverseer = useCallback((): Promise<RpcStub<Overseer>> => {
    return ensureOverseer();
  }, [ensureOverseer]);

  const createCapsuleGatekeeper = useCallback(
    async (accountId: number, url: string) => {
      const overseer = await ensureOverseer();
      return overseer.newGatekeeper(accountId, url);
    },
    [ensureOverseer],
  );

  const cancelObserverConfig = useCallback(() => {
    observerConfig?.reject(new Error("OBSERVER_CONFIG_CANCELLED"));
  }, [observerConfig]);

  return (
    // Flat enterprise treatment: no mesh, no watermark hexagon, no prompt-glow. The AppShell's
    // <main> already supplies a faint dotted grid as the page background.
    <div className="relative isolate flex min-h-full w-full flex-col items-center justify-start px-4 pb-16 pt-10 sm:px-8 sm:pt-16 lg:pt-24">
      {/* The brand hex mesh, restored and de-warmed for the new system: a gentle perspective hex
          grid receding upward. Masked to fade out before the composer so it stays a quiet backdrop. */}
      <div
        aria-hidden="true"
        className="pointer-events-none absolute inset-x-0 top-0 -z-10 h-[460px] overflow-hidden"
        style={{
          maskImage:
            "linear-gradient(to bottom, rgba(0,0,0,1) 0%, rgba(0,0,0,1) 45%, rgba(0,0,0,0) 95%)",
          WebkitMaskImage:
            "linear-gradient(to bottom, rgba(0,0,0,1) 0%, rgba(0,0,0,1) 45%, rgba(0,0,0,0) 95%)",
        }}
      >
        <MeshBackground />
      </div>
      <div className="flex w-full max-w-2xl flex-col items-stretch gap-8">
        {/* Hero */}
        <header className="text-center">
          <h1 className="text-3xl font-semibold tracking-tight leading-tight text-kumo-default sm:text-4xl">
            What are we working on?
          </h1>
          <p className="mx-auto mt-3 max-w-md text-[14px] leading-5 tracking-[-0.25px] text-kumo-subtle">
            Ask a question, create an output, or create an app that works with your tools and data.
          </p>
        </header>

        <div className="flex flex-col items-stretch gap-3">
          <HomeWorkspaceSelector
            workspaces={workspaces}
            loading={workspacesLoading}
            value={workspaceTarget}
            onChange={handleWorkspaceTargetChange}
          />

          {/* Composer */}
          <ChatInput
            createCapsuleGatekeeper={createCapsuleGatekeeper}
            getOverseer={getOverseer}
            onSend={handleSend}
            isAgentActive={false}
            models={models}
            selectedModel={selectedModel}
            onModelChange={handleModelChange}
            newChat
            offerFormats
            autoFocus
            minRows={3}
            seedText={seed?.text}
            seedNonce={seed?.nonce}
            draftStorageKey={currentUser
              ? composerDraftStorageKey(currentUser.id, "home")
              : undefined}
          />
        </div>

        {/* A few example work tasks to spark ideas. Picking one seeds the composer above. */}
        <HomeTaskSuggestions
          onPick={(suggestion) =>
            setSeed((prev) => ({ text: suggestion, nonce: (prev?.nonce ?? 0) + 1 }))
          }
        />
      </div>

      {observerConfig && (
        <ObserverConfigModal
          needs={observerConfig.needs}
          authenticatedApi={authenticatedApi}
          onConfirm={observerConfig.resolve}
          onCancel={cancelObserverConfig}
        />
      )}
    </div>
  );
}
