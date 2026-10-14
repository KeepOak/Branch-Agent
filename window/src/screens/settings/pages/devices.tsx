// Settings › Devices: the approved preview's eleven cards (preview.html PG local), drawn from Classic Computer & browser's
// own section data (set2/computer-more.tsx), its top blocks (set2/computer.tsx), On this computer (set1/local*.tsx) and
// the Everywhere tiles (customize/everywhere.tsx). Each Classic row becomes an R1 row on its card (spec-rows.tsx); a
// row Classic left out because Branch can't do it yet is a Coming row in its own words.
import { EverywhereTab } from "../../../places/customize/everywhere";
import "../../../places/customize/customize.css";
import { DEVICE_SECS as S, type SecSpec, type Spec } from "../../../places/settings/set2/computer-more";
import { ComputerBlock } from "../../../places/settings/set2/computer";
import { LocalBlock } from "../../../places/settings/set1/local";
import { specPage } from "./spec-rows";

/** A block of Classic's page as a section of its own, drawn as one bare row. */
const block = (t: string, lv: 0 | 1 | 2, body: SecSpec["body"]): SecSpec => ({ t, lv, body });
const ENDPOINT = "gateway.http.endpoints.chatCompletions.enabled";
const NO_KEY = "engine: a setting for it";
const NO_RUN = "engine: stopping, checking or clearing the models here";

/** Running models here, more (Classic set1/local-more.tsx), as row data. */
const RUNNING_MORE: SecSpec = { t: "Running models here, more", lv: 1, rows: [
  { t: "Fit the room to this computer", k: "sw", sub: "A model’s room is sized to the memory there is; using more asks first.", off: NO_KEY },
  { t: "Big downloads on a metered network", k: "seg", opts: [{ v: "ask", l: "Ask first" }, { v: "wait", l: "Wait for an unmetered one" }, { v: "go", l: "Go ahead" }], off: NO_KEY },
  { t: "Runtime download", k: "val", val: "Always", sub: "Every runtime Branch installs is checked against its published fingerprint." },
  { t: "Installed models", k: "btn", sub: "Pick which model answers first in Defaults.", off: NO_RUN },
  { t: "Bring in a model file", k: "btn", sub: "A GGUF or MLX file you already have; Branch reads what it is first.", off: NO_KEY },
  { t: "Keep a conversation’s working memory between sessions", k: "sw", sub: "Long conversations resume faster; uses disk.", off: NO_KEY },
  { t: "Make room for pictures and video", k: "sw", sub: "When making a picture needs the graphics memory, the chat model steps out first and comes back after.", off: NO_KEY },
  { t: "Teach tools to models without them", k: "sw", sub: "Tools are described in the message and the answer is read for them.", off: NO_KEY },
  { t: "Let other apps use Branch’s models", k: "sw", key: ENDPOINT, def: false, sub: "A local address that speaks OpenAI’s shape, for your other programs. Off until you choose: programs on this computer can use your models." },
  { t: "A rented graphics computer", k: "btn", sub: "Point Branch at a GPU computer you rent; it installs the server and starts your models there.", off: NO_KEY },
  { t: "Squeeze models to fit", k: "pick", opts: [{ v: "as", l: "As downloaded" }, { v: "8", l: "8-bit" }, { v: "4", l: "4-bit" }], sub: "Smaller files and memory, a little less sharp.", off: NO_KEY },
  { t: "On your phone", k: "btn", sub: "Small models that run on the phone itself.", off: "desktop: the Branch app on the phone" },
] satisfies Spec[] };

/** The preview's pairing row on Let Trunks use this computer, which Classic doesn't have. */
const PAIR_HERE: SecSpec = { t: "Lend this computer", lv: 0, rows: [
  { t: "Code from the other computer", k: "text", sub: "8 characters, two groups of 4. Make it on the other computer: Add a computer › Another computer.", off: "engine: pairing this computer to another Branch by code" },
] };

const PLAN: [string, SecSpec[]][] = [
  ["Everywhere", [
    block("Everywhere", 0, (c) => <div className="cz"><EverywhereTab engine={c.engine} openChannels={() => c.props.openSettings?.("chatapps")} /></div>),
    block("Recommended for you", 0, (c) => <LocalBlock {...c.props} part="recommended" />),
  ]],
  ["Computers they may use", [
    block("Waiting for your yes", 0, (c) => <ComputerBlock {...c.props} part="waiting" />),
    block("Computers they may use", 0, (c) => <ComputerBlock {...c.props} part="computers" />),
    block("Separate copies", 0, (c) => <ComputerBlock {...c.props} part="build" />),
  ]],
  ["Which Trunk uses which", [block("Which Trunk uses which", 0, (c) => <ComputerBlock {...c.props} part="which" />)]],
  ["Who is connected now", [S.WHO, S.EVERYTHING, S.ALLOWING, S.NETWORK_MORE, S.TECHNICAL]],
  ["Cloud computers", [S.CLOUD]],
  ["Phones and small devices", [S.PHONES_LENT, S.PHONES_SMALL]],
  ["Let Trunks use this computer", [PAIR_HERE, S.LET_TRUNKS, S.LENT_TECH]],
  ["Runtimes", [block("Runtimes", 0, (c) => <LocalBlock {...c.props} part="runtimes" />)]],
  ["Running models here", [block("This computer", 1, (c) => <LocalBlock {...c.props} part="hardware" />), RUNNING_MORE]],
  ["More places to run work", [S.MORE_PLACES, S.SEALED_TECH, S.LIMITS_TECH]],
  ["Where scripts run", [S.WHERE_MORE, S.SCRIPTS]],
];

export const DEVICES = specPage("devices", PLAN);
