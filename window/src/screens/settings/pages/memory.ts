// Settings › Memory & documents: the rows of the R1 page, in the approved preview's order and words (preview.html PG
// memory, item 36: Memory, Recall and memory files, Documents it reads, Library; every card from Classic Advanced, so the
// page shows from Advanced up and says so at Regular). Keys follow Classic Advanced (places/settings/set2/advanced.tsx,
// sections Memory, Memory more, Memory technical, Recall and memory files, Documents it reads and Library more), whose
// rows are wired and tested. A row the engine has no key for is Coming, naming what it waits for. Rows whose control does
// more than one key are drawn by the page (memory-live.tsx), named here as "slot" rows.
import type { Row, RowOption } from "../rows";
import { NO_KEY } from "./customize";

const MEMORY = "Memory";
const RECALL = "Recall and memory files";
const DOCS = "Documents it reads";
const LIBRARY = "Library";
/** Said on a row the engine always does, with no switch for it. */
const ALWAYS = "Always on in this engine; there is no switch for it.";

const no = (what: string, reason = NO_KEY) => ({ kind: "coming" as const, need: `config: ${what}`, reason });
const opts = (...labels: string[]): RowOption[] => labels.map((l) => ({ v: l, label: l }));
const slot = (calls: string[], reason: string) => ({ kind: "slot" as const, calls, reason });
const PROVIDERS: RowOption[] = [["openai", "OpenAI"], ["gemini", "Gemini"], ["voyage", "Voyage"], ["mistral", "Mistral"], ["bedrock", "Amazon Bedrock"], ["deepinfra", "DeepInfra"],
  ["github-copilot", "GitHub Copilot"], ["lmstudio", "LM Studio"], ["ollama", "Ollama"], ["local", "On this computer"], ["openai-compatible", "An OpenAI-compatible address"]].map(([v, label]) => ({ v, label }));

type Base = Pick<Row, "id" | "card" | "level" | "control" | "source"> & Partial<Row>;
const row = (r: Base): Row => ({ page: "memory", ...r });

export const MEMORY_ROWS: Row[] = [
  row({ id: "memory.memory.start", card: MEMORY, label: "How much memory loads at the start", help: "The whole memory file is kept. Only the copy loaded at the start is trimmed, and Branch says when it is.", level: 1, control: "number", unit: "characters", fallback: 20_000,
    source: { kind: "config", path: "agents.defaults.bootstrapMaxChars" } }),
  row({ id: "memory.memory.start-total", card: MEMORY, label: "All start files together", help: "All the files a Trunk reads first load up to this much together.", level: 1, control: "number", unit: "characters", fallback: 60_000,
    source: { kind: "config", path: "agents.defaults.bootstrapTotalMaxChars" } }),
  row({ id: "memory.memory.meaning", card: MEMORY, label: "Match by meaning", help: "Finds “invoice” when the fact says “bill”.", level: 1, control: "toggle", fallback: true, source: { kind: "config", path: "memory.search.store.vector.enabled" } }),
  row({ id: "memory.memory.meaning-check", card: MEMORY, label: "Meaning search", help: "Whether meaning search answers, and where it runs.", level: 1, control: "custom", source: slot(["doctor.memory.status"], "Checking meaning search comes in a later update.") }),
  row({ id: "memory.memory.provider", card: MEMORY, label: "Meaning search uses", help: "The service that turns facts into something searchable by meaning. Changing it rebuilds the index.", level: 1, control: "select", options: PROVIDERS, fallback: "openai",
    source: { kind: "config", path: "memory.search.provider" } }),
  row({ id: "memory.memory.share", card: MEMORY, label: "Share memory between Trunks", help: "Off: each Trunk keeps its own. Off until you choose: it changes where your data goes.", level: 1, control: "toggle", source: no("a shared memory switch") }),
  row({ id: "memory.memory.ask", card: MEMORY, label: "Ask before remembering", help: "Off: a Trunk writes what is worth keeping as it works, and the conversation shows “Remembered”. On: it asks “Remember this?” first.", level: 1, control: "toggle", source: no("an ask-before-remembering switch") }),
  row({ id: "memory.memory.engine", card: MEMORY, label: "Memory engine", help: "One engine stores and searches memory. Choosing one turns the others off.", level: 2, control: "custom", source: slot(["plugins.list", "config.patch"], "Choosing the memory engine comes in a later update.") }),
  row({ id: "memory.memory.outside", card: MEMORY, label: "Outside memory", help: "Off until you choose: it changes where your data goes.", level: 1, control: "segmented", options: opts("None", "Mem0", "Honcho", "Hindsight"), fallback: "None",
    source: no("an outside memory service", "This engine has none of these memory services.") }),
  row({ id: "memory.memory.git", card: MEMORY, label: "Keep a history in Git", help: "Every change to memory as a commit, on this computer.", level: 1, control: "toggle", source: no("a memory history switch") }),
  row({ id: "memory.memory.recall", card: MEMORY, label: "Recall before replying", help: "Before a reply about the past, a helper searches memory more deeply when the quick search found nothing strong. Off until you choose: it can add a model call before a reply.", level: 1, control: "toggle",
    source: slot(["plugins.list", "config.patch"], "Its plugin isn’t installed in this engine.") }),
  row({ id: "memory.memory.wiki", card: MEMORY, label: "Memory wiki", help: "Keeps what Trunks know as linked pages, each fact with where it came from, readable as Markdown. Off until you choose: it adds a second, page-shaped copy of what Trunks know.", level: 1, control: "toggle",
    source: slot(["plugins.list", "config.patch"], "Its plugin isn’t installed in this engine.") }),
  row({ id: "memory.memory.tidy", card: MEMORY, label: "Tidy by meaning each night", help: "At 3 AM it merges facts that say the same thing in different words. Every merge is listed.", level: 1, control: "custom", source: slot([], "Last night’s tidy-up comes in a later update.") }),
  row({ id: "memory.memory.project-notes", card: MEMORY, label: "Project notes as files", help: "Each project keeps its memory as Markdown in its own folder, so you can read and edit it.", level: 1, control: "button", button: "Open", source: no("project notes as files") }),
  row({ id: "memory.memory.follow-ups", card: MEMORY, label: "Follow-ups made whole", help: "A short follow-up like “and July?” becomes a full question before it searches.", level: 1, control: "button", button: "Show one", source: no("whole follow-up questions") }),
  row({ id: "memory.memory.scratch", card: MEMORY, label: "Scratch space for pasted text", help: "Long text you paste is used for that job, then let go. It never becomes memory.", level: 1, control: "button", button: "Show it", source: no("a scratch space for pasted text") }),
  row({ id: "memory.memory.cards", card: MEMORY, label: "Knowledge cards", help: "A short card made from a conversation: the question, the answer and where it came from.", level: 1, control: "button", button: "See them", source: no("knowledge cards") }),
  row({ id: "memory.memory.own-notes", card: MEMORY, label: "Notes it keeps for itself", help: "Short working notes a Trunk writes and rewrites, such as how a site behaves.", level: 1, control: "button", button: "Read them", source: no("a Trunk's own working notes") }),
  row({ id: "memory.memory.search", card: MEMORY, label: "Search memory", help: "Turn off for replies that use no memory at all.", level: 2, control: "toggle", fallback: true, source: { kind: "config", path: "memory.search.enabled" } }),
  row({ id: "memory.memory.sessions", card: MEMORY, label: "Also search past conversations", help: "Off until you choose: it reads every past conversation into the index.", level: 2, control: "toggle", source: slot(["config.patch"], "Searching past conversations comes in a later update.") }),
  row({ id: "memory.memory.cache", card: MEMORY, label: "Keep search results ready", help: "Faster re-indexing; uses a little disk.", level: 2, control: "toggle", fallback: true, source: { kind: "config", path: "memory.search.cache.enabled" } }),
  row({ id: "memory.memory.batch", card: MEMORY, label: "Index in batches", help: "Faster for big indexes where the service allows it. Off, as the services’ batch requests are opt-in.", level: 2, control: "toggle", fallback: false, source: { kind: "config", path: "memory.search.remote.batch.enabled" } }),
  row({ id: "memory.memory.multimodal", card: MEMORY, label: "Pictures and audio in extra folders", help: "Off until you choose: the files are uploaded to the meaning-search service.", level: 2, control: "toggle", fallback: false, source: { kind: "config", path: "memory.search.multimodal.enabled" } }),
  row({ id: "memory.memory.extra-paths", card: MEMORY, label: "Extra folders to search", level: 2, control: "custom", source: slot(["config.patch"], "Extra folders to search come in a later update.") }),
  row({ id: "memory.memory.citations", card: MEMORY, label: "Show where a memory came from", help: "Auto shows it when it helps.", level: 2, control: "segmented", options: [{ v: "auto", label: "Auto" }, { v: "on", label: "Always" }, { v: "off", label: "Never" }], fallback: "auto",
    source: { kind: "config", path: "memory.citations" } }),
  row({ id: "memory.memory.every", card: MEMORY, label: "Every memory setting", level: 2, control: "custom", source: slot(["config.get", "config.patch"], "Editing every memory setting comes in a later update.") }),

  row({ id: "memory.recall.mid-task", card: RECALL, label: "Bring up what it remembers, mid-task", help: "When something it knows matters to the step it’s on, it says so. Off until you choose: it can add a model call while it works.", level: 1, control: "toggle", source: no("a mid-task recall switch") }),
  row({ id: "memory.recall.helpers", card: RECALL, label: "Helpers and side conversations may", help: "What a helper or a /btw side question can do with memory.", level: 1, control: "segmented", options: opts("Read memory only", "Read and write"), fallback: "Read and write",
    source: no("what helpers may do with memory") }),
  row({ id: "memory.recall.flush", card: RECALL, label: "Save notes before tidying a conversation", help: "Before older messages fold away, the Trunk writes down what is worth keeping.", level: 1, control: "toggle", fallback: true,
    source: { kind: "config", path: "agents.defaults.compaction.memoryFlush.enabled" } }),
  row({ id: "memory.recall.computer-notes", card: RECALL, label: "Notes about this computer", help: "Short files kept up to date in the background: this computer, its disks, the devices on your network and what you use most. Off until you choose.", level: 1, control: "button", button: "Read them",
    source: no("notes about this computer") }),
  row({ id: "memory.recall.keep-computer-notes", card: RECALL, label: "Keep notes about this computer", help: "Off until you choose: it looks at your network, disks and recent activity.", level: 1, control: "toggle", source: no("a computer notes switch") }),
  row({ id: "memory.recall.other-agents", card: RECALL, label: "Learn from other coding agents’ history on this computer", help: "Past sessions other coding tools left on disk come up when they matter. Off until you choose: it reads their files.", level: 1, control: "custom",
    source: slot(["migrations.memory.plan", "migrations.memory.apply"], "Bringing in other coding agents’ memory comes in a later update.") }),
  row({ id: "memory.recall.rings", card: RECALL, label: "Rings’ own instructions for this workspace", help: "Rings works the usual way. Make one to tell it what matters here.", level: 1, control: "button", button: "Make one", source: no("Rings instructions for a workspace") }),
  row({ id: "memory.recall.recent", card: RECALL, label: "Prefer recent notes", help: "Newer notes win ties; a note’s weight halves every 30 days.", level: 2, control: "toggle", fallback: true, source: no("a recent-notes switch", ALWAYS) }),
  row({ id: "memory.recall.vary", card: RECALL, label: "Vary the results", help: "Leaves out near-repeats so a search brings back different things.", level: 2, control: "toggle", fallback: true, source: no("a vary-results switch", ALWAYS) }),
  row({ id: "memory.recall.watch", card: RECALL, label: "Pick up edits to memory files", help: "Your own edits to the Markdown files are read back in; a file it can’t read is set aside, never deleted.", level: 2, control: "toggle", source: no("a memory file watch switch") }),
  row({ id: "memory.recall.score", card: RECALL, label: "Score memories by whether they helped", help: "After each answer, the memories it used are marked helped or not, and rank that way. Off until you choose: it adds a model call.", level: 2, control: "toggle", source: no("a memory scoring switch") }),
  row({ id: "memory.recall.git-copy", card: RECALL, label: "Also copy the history to", help: "A second Git address, such as a private repository. Empty: only on this computer. Needs Keep a history in Git.", level: 2, control: "text", source: no("a second Git address for memory") }),

  row({ id: "memory.docs.search", card: DOCS, label: "Search documents by", help: "Meaning finds “bill” for “invoice”; words find exact names and numbers. Both is the usual.", level: 1, control: "segmented", options: opts("Meaning and words", "Meaning", "Words"), fallback: "Meaning and words",
    source: no("how documents are searched") }),
  row({ id: "memory.docs.rerank", card: DOCS, label: "Re-order the best passages", help: "A second pass that puts the most useful passages first. A model service is used only if you have one set up for this.", level: 1, control: "segmented", options: opts("Off", "On this computer", "A model service"), fallback: "Off",
    source: no("a passage re-ordering choice") }),
  row({ id: "memory.docs.reach", card: DOCS, label: "How documents reach a Trunk", help: "Added: the best passages go with the message. Searches itself: the Trunk looks things up when it needs to.", level: 1, control: "segmented", options: opts("Best passages are added", "It searches them itself"),
    fallback: "Best passages are added", source: no("how documents reach a Trunk") }),
  row({ id: "memory.docs.attach", card: DOCS, label: "A file you attach", help: "Whole when it fits; otherwise only the parts that match.", level: 1, control: "segmented", options: opts("Whole when it fits", "Searched"), fallback: "Whole when it fits", source: no("how an attached file is read") }),
  row({ id: "memory.docs.ocr", card: DOCS, label: "Read text in scans and pictures", help: "Off until you choose: scans may be sent to the reading service you pick.", level: 1, control: "toggle", source: no("a text-in-scans switch") }),
  row({ id: "memory.docs.links", card: DOCS, label: "Keep links from messages", help: "Links people send are saved with a title and a short summary, to find later. Off until you choose: it opens every link it sees.", level: 1, control: "toggle", source: no("a keep-links switch") }),
  row({ id: "memory.docs.contents", card: DOCS, label: "Read long documents by their contents page", help: "For long PDFs: it reads the headings, then opens the right pages, and says which page each answer came from.", level: 1, control: "toggle", source: no("a contents-page reading switch") }),
  row({ id: "memory.docs.code", card: DOCS, label: "Index code folders", help: "Only changed files are read again. Ask with @codebase or @folder, or find a function by name.", level: 1, control: "toggle", source: no("a code folder index") }),
  row({ id: "memory.docs.reader", card: DOCS, label: "Read files with", help: "Turns PDF, Word, Office and web pages into plain text.", level: 2, control: "segmented", options: opts("Built in", "A document service"), fallback: "Built in", source: no("a document reader") }),
  row({ id: "memory.docs.split", card: DOCS, label: "Split documents at", help: "Where long documents are cut into passages; headings stay with each passage.", level: 2, control: "segmented", options: opts("Headings", "Sentences", "Meaning"), fallback: "Headings", source: no("where documents are split") }),
  row({ id: "memory.docs.describe", card: DOCS, label: "Describe each passage before indexing", help: "A sentence on where each passage sits in its document. Off until you choose: one model call per passage.", level: 2, control: "toggle", source: no("a passage description switch") }),
  row({ id: "memory.docs.follow", card: DOCS, label: "Follow links between passages", help: "Finds passages that connect to the best ones.", level: 2, control: "toggle", source: no("a passage links switch") }),
  row({ id: "memory.docs.where", card: DOCS, label: "Where the index lives", help: "This computer needs no server. A database server is for big or shared indexes.", level: 2, control: "segmented", options: opts("This computer", "A database server"), fallback: "This computer", source: no("where the document index lives") }),
  row({ id: "memory.docs.server", card: DOCS, label: "Database server address", help: "Vector or storage databases such as Postgres, Qdrant or Redis.", level: 2, control: "text", source: no("a document index server") }),

  row({ id: "memory.library.meaning", card: LIBRARY, label: "Search documents by meaning", help: "Finds the lease clause about repairs when you ask “who fixes the boiler”.", level: 1, control: "toggle", source: no("a Library meaning search switch") }),
  row({ id: "memory.library.local-index", card: LIBRARY, label: "A local index of mail, calendar and messages", help: "Built and kept on this computer, for faster answers.", level: 1, control: "toggle", source: no("a local index switch") }),
  row({ id: "memory.library.versions", card: LIBRARY, label: "Keep versions of what Trunks make", help: "Every file in Made for you keeps its versions and a checksum.", level: 1, control: "toggle", source: no("a versions switch") }),
  row({ id: "memory.library.rewrite", card: LIBRARY, label: "Rewrite short notes", help: "Clearer, shorter, fixed or more formal.", level: 1, control: "custom", source: slot([], "Rewriting notes from here comes in a later update.") }),
];
