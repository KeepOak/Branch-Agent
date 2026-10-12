// Ported from old Branch Agent's finished 44-theme catalogue. Values are its light/dark tokens mapped to the 13 window colours.
export const LEGACY_THEMES = [
  {
    "id": "forest",
    "name": "Forest",
    "group": "KeepOak"
  },
  {
    "id": "earth",
    "name": "Earth",
    "group": "KeepOak"
  },
  {
    "id": "slate",
    "name": "Slate",
    "group": "KeepOak"
  },
  {
    "id": "nocturne",
    "name": "Nocturne",
    "group": "KeepOak"
  },
  {
    "id": "arctic",
    "name": "Arctic",
    "group": "KeepOak"
  },
  {
    "id": "terracotta",
    "name": "Terracotta",
    "group": "KeepOak"
  },
  {
    "id": "lavender",
    "name": "Lavender",
    "group": "KeepOak"
  },
  {
    "id": "mint",
    "name": "Mint",
    "group": "KeepOak"
  },
  {
    "id": "cherry",
    "name": "Cherry",
    "group": "KeepOak"
  },
  {
    "id": "ocean",
    "name": "Ocean",
    "group": "KeepOak"
  },
  {
    "id": "sunset",
    "name": "Sunset",
    "group": "KeepOak"
  },
  {
    "id": "sepia",
    "name": "Sepia",
    "group": "KeepOak"
  },
  {
    "id": "meadow",
    "name": "Meadow",
    "group": "KeepOak"
  },
  {
    "id": "stone",
    "name": "Stone",
    "group": "KeepOak"
  },
  {
    "id": "harbor",
    "name": "Harbor",
    "group": "KeepOak"
  },
  {
    "id": "signal",
    "name": "Midnight Signal",
    "group": "KeepOak"
  },
  {
    "id": "mono",
    "name": "Mono",
    "group": "KeepOak"
  },
  {
    "id": "amber-crt",
    "name": "Amber terminal",
    "group": "KeepOak"
  },
  {
    "id": "green-crt",
    "name": "Green terminal",
    "group": "KeepOak"
  },
  {
    "id": "catppuccin",
    "name": "Catppuccin",
    "group": "Editors & terminals"
  },
  {
    "id": "nord",
    "name": "Nord",
    "group": "Editors & terminals"
  },
  {
    "id": "dracula",
    "name": "Dracula",
    "group": "Editors & terminals"
  },
  {
    "id": "solarized",
    "name": "Solarized",
    "group": "Editors & terminals"
  },
  {
    "id": "gruvbox",
    "name": "Gruvbox",
    "group": "Editors & terminals"
  },
  {
    "id": "rose-pine",
    "name": "Rosé Pine",
    "group": "Editors & terminals"
  },
  {
    "id": "rose-pine-moon",
    "name": "Rosé Pine Moon",
    "group": "Editors & terminals"
  },
  {
    "id": "tokyo-night",
    "name": "Tokyo Night",
    "group": "Editors & terminals"
  },
  {
    "id": "everforest",
    "name": "Everforest",
    "group": "Editors & terminals"
  },
  {
    "id": "one-dark",
    "name": "One Dark",
    "group": "Editors & terminals"
  },
  {
    "id": "monokai",
    "name": "Monokai Pro",
    "group": "Editors & terminals"
  },
  {
    "id": "ayu",
    "name": "Ayu",
    "group": "Editors & terminals"
  },
  {
    "id": "ayu-mirage",
    "name": "Ayu Mirage",
    "group": "Editors & terminals"
  },
  {
    "id": "kanagawa",
    "name": "Kanagawa",
    "group": "Editors & terminals"
  },
  {
    "id": "palenight",
    "name": "Palenight",
    "group": "Editors & terminals"
  },
  {
    "id": "material-ocean",
    "name": "Material Ocean",
    "group": "Editors & terminals"
  },
  {
    "id": "github",
    "name": "GitHub",
    "group": "Editors & terminals"
  },
  {
    "id": "horizon",
    "name": "Horizon",
    "group": "Editors & terminals"
  },
  {
    "id": "synthwave",
    "name": "Synthwave",
    "group": "Editors & terminals"
  },
  {
    "id": "night-owl",
    "name": "Night Owl",
    "group": "Editors & terminals"
  },
  {
    "id": "poimandres",
    "name": "Poimandres",
    "group": "Editors & terminals"
  },
  {
    "id": "vesper",
    "name": "Vesper",
    "group": "Editors & terminals"
  },
  {
    "id": "flexoki",
    "name": "Flexoki",
    "group": "Editors & terminals"
  },
  {
    "id": "oceanic",
    "name": "Oceanic Next",
    "group": "Editors & terminals"
  },
  {
    "id": "nightfox",
    "name": "Nightfox",
    "group": "Editors & terminals"
  }
] as const;
export const LEGACY_PAIRS: Record<string, { light: string[]; dark: string[] }> = {
  "forest": {
    "light": [
      "#dde7da",
      "#e8eee4",
      "#f1f6ed",
      "#12211a",
      "#3b4940",
      "#4d5a51",
      "#c3cdc1",
      "#e07033",
      "#e07033",
      "#1a1a1a",
      "#005e28",
      "#684e04",
      "#942b2a"
    ],
    "dark": [
      "#03140b",
      "#071b11",
      "#0f2418",
      "#edf1ea",
      "#bec5bd",
      "#8f9b93",
      "#213128",
      "#e07033",
      "#e07033",
      "#1a1a1a",
      "#6fd087",
      "#e0af3b",
      "#ff958e"
    ]
  },
  "earth": {
    "light": [
      "#f3ece1",
      "#fbf4ea",
      "#fdfcfb",
      "#372a21",
      "#594d44",
      "#675543",
      "#dbd3c8",
      "#77523b",
      "#77523b",
      "#ffffff",
      "#03652c",
      "#6f5305",
      "#9a322f"
    ],
    "dark": [
      "#251c17",
      "#2c211a",
      "#352921",
      "#f5e8d7",
      "#cbbfb1",
      "#c5b19b",
      "#403730",
      "#e4ba94",
      "#e4ba94",
      "#1a1a1a",
      "#6fd087",
      "#e0af3b",
      "#ff958e"
    ]
  },
  "slate": {
    "light": [
      "#eaf0f2",
      "#f3f7f8",
      "#fcfdfd",
      "#23343e",
      "#43525b",
      "#455b66",
      "#d0d8db",
      "#3f6378",
      "#3f6378",
      "#ffffff",
      "#00682d",
      "#735601",
      "#9d3532"
    ],
    "dark": [
      "#18242c",
      "#1e2c35",
      "#27353f",
      "#e3eef3",
      "#c7d2d7",
      "#b1c5d0",
      "#323e46",
      "#b0d0e0",
      "#b0d0e0",
      "#1a1a1a",
      "#6fd087",
      "#e3b23f",
      "#fea19a"
    ]
  },
  "nocturne": {
    "light": [
      "#f4f1e8",
      "#fbf9f2",
      "#fdfdfc",
      "#1b2030",
      "#464a55",
      "#565c6b",
      "#d8d6d0",
      "#8a6a12",
      "#8a6a12",
      "#ffffff",
      "#00682d",
      "#735601",
      "#9d3532"
    ],
    "dark": [
      "#0e1526",
      "#141c30",
      "#1c253a",
      "#edebe3",
      "#c0c0bd",
      "#a1a7b7",
      "#2b313f",
      "#d4a73a",
      "#d4a73a",
      "#1a1a1a",
      "#6fd087",
      "#e0af3b",
      "#ff958e"
    ]
  },
  "arctic": {
    "light": [
      "#f2f7fa",
      "#fbfcfd",
      "#fdfefe",
      "#16232b",
      "#424d54",
      "#4d606b",
      "#d5dbdf",
      "#2b7a99",
      "#2b7a99",
      "#ffffff",
      "#076b30",
      "#765906",
      "#a13835"
    ],
    "dark": [
      "#0f1b22",
      "#13222a",
      "#1b2b33",
      "#e6f0f5",
      "#bbc5cb",
      "#9cb2bd",
      "#2b373d",
      "#5fc4e8",
      "#5fc4e8",
      "#1a1a1a",
      "#6fd087",
      "#e0af3b",
      "#ff958e"
    ]
  },
  "terracotta": {
    "light": [
      "#fbf3ec",
      "#fef8f2",
      "#fefdfc",
      "#3b2a22",
      "#61524a",
      "#6e584c",
      "#e2d9d2",
      "#c2532d",
      "#c2532d",
      "#ffffff",
      "#076b30",
      "#765906",
      "#a13835"
    ],
    "dark": [
      "#23180f",
      "#2a1e13",
      "#33261b",
      "#f6ebe2",
      "#ccc1b8",
      "#b8a496",
      "#3e332a",
      "#e8845a",
      "#e8845a",
      "#1a1a1a",
      "#6fd087",
      "#e0af3b",
      "#ff958e"
    ]
  },
  "lavender": {
    "light": [
      "#f5f3fb",
      "#fcfbfe",
      "#fefdfe",
      "#26223a",
      "#4f4c61",
      "#5d5875",
      "#dad8e2",
      "#6c4fd8",
      "#6c4fd8",
      "#ffffff",
      "#076b30",
      "#765906",
      "#a13835"
    ],
    "dark": [
      "#17142a",
      "#1d1a33",
      "#25223c",
      "#ece9f7",
      "#c1bece",
      "#aba5c7",
      "#333045",
      "#b4a2ff",
      "#b4a2ff",
      "#1a1a1a",
      "#6fd087",
      "#e0af3b",
      "#ff958e"
    ]
  },
  "mint": {
    "light": [
      "#f0f8f3",
      "#fafdfb",
      "#fdfefd",
      "#16302a",
      "#425852",
      "#4a625a",
      "#d4ded9",
      "#1a8759",
      "#1a8759",
      "#ffffff",
      "#076b30",
      "#765906",
      "#a13835"
    ],
    "dark": [
      "#0e1f19",
      "#12261f",
      "#1a2f26",
      "#e4f2eb",
      "#b9c8c1",
      "#9bbaad",
      "#2a3a34",
      "#5fd3a0",
      "#5fd3a0",
      "#1a1a1a",
      "#6fd087",
      "#e0af3b",
      "#ff958e"
    ]
  },
  "cherry": {
    "light": [
      "#fdf2f4",
      "#fefbfb",
      "#fffdfd",
      "#33141c",
      "#5b4047",
      "#744f5a",
      "#e3d5d8",
      "#c21e44",
      "#c21e44",
      "#ffffff",
      "#076b30",
      "#735601",
      "#a13835"
    ],
    "dark": [
      "#1f0f14",
      "#261319",
      "#2f1a20",
      "#f7e6ea",
      "#ccbbbf",
      "#bc949f",
      "#3b2b30",
      "#ff6b8a",
      "#ff6b8a",
      "#1a1a1a",
      "#6fd087",
      "#e0af3b",
      "#ff958e"
    ]
  },
  "ocean": {
    "light": [
      "#eef5fb",
      "#f9fcfe",
      "#fdfefe",
      "#0f2540",
      "#3c4f65",
      "#475d76",
      "#d1dae3",
      "#0b67b2",
      "#0b67b2",
      "#ffffff",
      "#076b30",
      "#765906",
      "#a13835"
    ],
    "dark": [
      "#06182b",
      "#0a2038",
      "#122943",
      "#e3eef9",
      "#b7c3d0",
      "#92acc7",
      "#233446",
      "#3aa7f5",
      "#3aa7f5",
      "#1a1a1a",
      "#6fd087",
      "#e0af3b",
      "#ff958e"
    ]
  },
  "sunset": {
    "light": [
      "#fff4ee",
      "#fffbf9",
      "#fffdfd",
      "#33202a",
      "#5c4a51",
      "#725662",
      "#e4d8d5",
      "#dd582f",
      "#dd582f",
      "#1a1a1a",
      "#076b30",
      "#765906",
      "#a13835"
    ],
    "dark": [
      "#1d1220",
      "#251729",
      "#2e1e32",
      "#f8e8ec",
      "#ccbdc3",
      "#c39db1",
      "#392e3b",
      "#ff8a5b",
      "#ff8a5b",
      "#1a1a1a",
      "#6fd087",
      "#e0af3b",
      "#ff958e"
    ]
  },
  "sepia": {
    "light": [
      "#f4ecdd",
      "#f9f3e6",
      "#fdfbf5",
      "#3a3024",
      "#584e42",
      "#635440",
      "#dcd4c5",
      "#7a5230",
      "#7a5230",
      "#ffffff",
      "#03652c",
      "#6f5305",
      "#9a322f"
    ],
    "dark": [
      "#2a231b",
      "#312920",
      "#3a3228",
      "#efe5d3",
      "#cfc6b6",
      "#c7b79e",
      "#443c33",
      "#d9a06c",
      "#d9a06c",
      "#1a1a1a",
      "#6fd087",
      "#e3b23f",
      "#fea19a"
    ]
  },
  "meadow": {
    "light": [
      "#faf7f0",
      "#fdfcfa",
      "#fefefd",
      "#1f2a23",
      "#4b534c",
      "#55625a",
      "#dedcd5",
      "#5e7f53",
      "#5e7f53",
      "#ffffff",
      "#076b30",
      "#765906",
      "#a13835"
    ],
    "dark": [
      "#0d110c",
      "#141813",
      "#1c201b",
      "#ecf0eb",
      "#bfc3be",
      "#9aa197",
      "#2a2e29",
      "#8db082",
      "#8db082",
      "#1a1a1a",
      "#6fd087",
      "#e0af3b",
      "#ff958e"
    ]
  },
  "stone": {
    "light": [
      "#efeae2",
      "#f5f1eb",
      "#fdf9f3",
      "#2a2622",
      "#514d48",
      "#5d554c",
      "#d5d1c9",
      "#a85a3f",
      "#a85a3f",
      "#ffffff",
      "#03652c",
      "#6f5305",
      "#9a3230"
    ],
    "dark": [
      "#140e0c",
      "#1b1512",
      "#241d1a",
      "#f3edeb",
      "#c6c0be",
      "#a59994",
      "#312b29",
      "#df8c70",
      "#df8c70",
      "#1a1a1a",
      "#6fd087",
      "#e0af3b",
      "#ff958e"
    ]
  },
  "harbor": {
    "light": [
      "#f6eeeb",
      "#fbf8f7",
      "#fefdfc",
      "#211814",
      "#4c433f",
      "#635853",
      "#dad2cf",
      "#b85207",
      "#b85207",
      "#ffffff",
      "#03652c",
      "#6f5406",
      "#9d3532"
    ],
    "dark": [
      "#0b1b2e",
      "#172e4c",
      "#213a5c",
      "#f1f5f9",
      "#c3c9d0",
      "#abc0d5",
      "#293748",
      "#f97316",
      "#f97316",
      "#1a1a1a",
      "#7cdd93",
      "#f0bf4e",
      "#fdb5af"
    ]
  },
  "signal": {
    "light": [
      "#e9f2f4",
      "#f5fafb",
      "#fcfdfd",
      "#111d1f",
      "#3c484a",
      "#515e60",
      "#cdd6d8",
      "#0a8091",
      "#0a8091",
      "#ffffff",
      "#00682d",
      "#735601",
      "#9d3532"
    ],
    "dark": [
      "#0f172a",
      "#182235",
      "#212c3e",
      "#e2e8f0",
      "#bcc2cc",
      "#a7b6cb",
      "#2a3244",
      "#22d3ee",
      "#22d3ee",
      "#1a1a1a",
      "#6fd087",
      "#e0af3b",
      "#ff958e"
    ]
  },
  "mono": {
    "light": [
      "#ffffff",
      "#f8f8f8",
      "#fcfcfc",
      "#111111",
      "#414141",
      "#585858",
      "#e0e0e0",
      "#1a1a1a",
      "#1a1a1a",
      "#ffffff",
      "#046f31",
      "#7a5b01",
      "#a43b38"
    ],
    "dark": [
      "#000000",
      "#0b0b0b",
      "#141414",
      "#ffffff",
      "#cccccc",
      "#9a9a9a",
      "#212121",
      "#ffd60a",
      "#ffd60a",
      "#1a1a1a",
      "#6fd087",
      "#e0af3b",
      "#ff958e"
    ]
  },
  "amber-crt": {
    "light": [
      "#f4efe9",
      "#fbf8f5",
      "#fdfdfc",
      "#1f1a12",
      "#4a453d",
      "#615a51",
      "#d8d3cd",
      "#9a6a0b",
      "#9a6a0b",
      "#ffffff",
      "#03652c",
      "#6f5406",
      "#9d3532"
    ],
    "dark": [
      "#0c0a05",
      "#120f07",
      "#1a160e",
      "#ffb000",
      "#e29c01",
      "#ca9335",
      "#2c2004",
      "#ffb000",
      "#ffb000",
      "#1a1a1a",
      "#6fd087",
      "#e0af3b",
      "#ff958e"
    ]
  },
  "green-crt": {
    "light": [
      "#ecf2ec",
      "#f7faf7",
      "#fcfdfc",
      "#161d16",
      "#414841",
      "#525b53",
      "#d0d6d0",
      "#04892e",
      "#04892e",
      "#ffffff",
      "#00682d",
      "#735601",
      "#9d3532"
    ],
    "dark": [
      "#050a06",
      "#09100a",
      "#101811",
      "#33ff66",
      "#2ace53",
      "#3db857",
      "#0b2a12",
      "#33ff66",
      "#33ff66",
      "#1a1a1a",
      "#6fd087",
      "#e0af3b",
      "#ff958e"
    ]
  },
  "catppuccin": {
    "light": [
      "#eff1f5",
      "#e9ecf1",
      "#edf0f6",
      "#474a63",
      "#474a63",
      "#56586d",
      "#d9dbe2",
      "#8839ef",
      "#8839ef",
      "#ffffff",
      "#00682d",
      "#735601",
      "#9e3532"
    ],
    "dark": [
      "#1e1e2e",
      "#2a2a3c",
      "#343546",
      "#cdd6f4",
      "#cdd6f4",
      "#b9c0dc",
      "#353648",
      "#cba6f7",
      "#cba6f7",
      "#1a1a1a",
      "#72d38a",
      "#eab847",
      "#feaaa3"
    ]
  },
  "nord": {
    "light": [
      "#eceff4",
      "#e7ebf1",
      "#ecf0f7",
      "#2e3440",
      "#4c525d",
      "#525c70",
      "#d3d7dd",
      "#6487b2",
      "#6487b2",
      "#1a1a1a",
      "#00682d",
      "#735601",
      "#9d3532"
    ],
    "dark": [
      "#2e3440",
      "#363d4b",
      "#3f4656",
      "#eceff4",
      "#e8ebf0",
      "#ced4df",
      "#474c57",
      "#88c0d0",
      "#88c0d0",
      "#1a1a1a",
      "#8deea3",
      "#ffd47e",
      "#fecdc9"
    ]
  },
  "dracula": {
    "light": [
      "#f1eff6",
      "#f9f8fb",
      "#fdfdfe",
      "#1c1921",
      "#47444c",
      "#5d5963",
      "#d5d3da",
      "#855bbc",
      "#855bbc",
      "#ffffff",
      "#00682d",
      "#6f5406",
      "#9d3532"
    ],
    "dark": [
      "#282a36",
      "#393c4c",
      "#45485a",
      "#f8f8f2",
      "#ecece7",
      "#cddafe",
      "#43454e",
      "#bd93f9",
      "#bd93f9",
      "#1a1a1a",
      "#97f8ac",
      "#fee0a4",
      "#ffdbd7"
    ]
  },
  "solarized": {
    "light": [
      "#fdf6e3",
      "#f3edda",
      "#f6f0dd",
      "#394e55",
      "#41555b",
      "#536060",
      "#e4e0d1",
      "#268bd2",
      "#268bd2",
      "#1a1a1a",
      "#00682d",
      "#735601",
      "#9d3532"
    ],
    "dark": [
      "#002b36",
      "#04323d",
      "#0f3b46",
      "#bed0d2",
      "#b6c9cc",
      "#9fb7be",
      "#19404a",
      "#268bd2",
      "#268bd2",
      "#1a1a1a",
      "#6fd087",
      "#e3b23f",
      "#fea19a"
    ]
  },
  "gruvbox": {
    "light": [
      "#fbf1c7",
      "#f0e2b9",
      "#f3e4ba",
      "#3c3836",
      "#4f4b45",
      "#5f5348",
      "#e2d9b4",
      "#d65d0e",
      "#d65d0e",
      "#1a1a1a",
      "#05612b",
      "#6c5000",
      "#972e2d"
    ],
    "dark": [
      "#282828",
      "#343231",
      "#3f3c3a",
      "#ebdbb2",
      "#e3d4ac",
      "#cebfa9",
      "#413f3a",
      "#fe8019",
      "#fe8019",
      "#1a1a1a",
      "#7cdd93",
      "#f4c252",
      "#febab3"
    ]
  },
  "rose-pine": {
    "light": [
      "#faf4ed",
      "#fdf8f1",
      "#fefdfc",
      "#464261",
      "#58546f",
      "#625e7b",
      "#e3dddb",
      "#d7827e",
      "#d7827e",
      "#1a1a1a",
      "#076b30",
      "#765906",
      "#a13835"
    ],
    "dark": [
      "#191724",
      "#1d1b2a",
      "#242233",
      "#e0def4",
      "#b8b6ca",
      "#aca8c7",
      "#33313f",
      "#ebbcba",
      "#ebbcba",
      "#1a1a1a",
      "#6fd087",
      "#e0af3b",
      "#ff958e"
    ]
  },
  "rose-pine-moon": {
    "light": [
      "#faf4ed",
      "#fdf8f1",
      "#fefdfc",
      "#464261",
      "#58546f",
      "#625e7b",
      "#e3dddb",
      "#d7827e",
      "#d7827e",
      "#1a1a1a",
      "#076b30",
      "#765906",
      "#a13835"
    ],
    "dark": [
      "#232136",
      "#27253c",
      "#2f2d44",
      "#e0def4",
      "#c2c0d6",
      "#b5b1d0",
      "#3c3a4f",
      "#ea9a97",
      "#ea9a97",
      "#1a1a1a",
      "#6fd087",
      "#e0af3b",
      "#ff958e"
    ]
  },
  "tokyo-night": {
    "light": [
      "#e6e7ed",
      "#eeeff4",
      "#f6f7fc",
      "#343b58",
      "#424964",
      "#53555c",
      "#cfd1da",
      "#2959aa",
      "#2959aa",
      "#ffffff",
      "#05612b",
      "#6c5000",
      "#972e2d"
    ],
    "dark": [
      "#1a1b26",
      "#202333",
      "#292c3d",
      "#b6bee3",
      "#b9c1e6",
      "#a5b0df",
      "#2e303f",
      "#7aa2f7",
      "#7aa2f7",
      "#1a1a1a",
      "#6fd087",
      "#e0af3b",
      "#ff958e"
    ]
  },
  "everforest": {
    "light": [
      "#fdf6e3",
      "#f7f2dc",
      "#fbf7e0",
      "#435158",
      "#4a585e",
      "#5b675a",
      "#e5e1d1",
      "#8da101",
      "#8da101",
      "#1a1a1a",
      "#046e31",
      "#7a5b01",
      "#a43b38"
    ],
    "dark": [
      "#2d353b",
      "#313b41",
      "#394449",
      "#ede0c3",
      "#f0e3c6",
      "#c3d1c7",
      "#464b4d",
      "#a7c080",
      "#a7c080",
      "#1a1a1a",
      "#85e79c",
      "#fbc959",
      "#fdc4c0"
    ]
  },
  "one-dark": {
    "light": [
      "#fafafa",
      "#f3f3f4",
      "#f7f7f8",
      "#383a42",
      "#57595f",
      "#5e616b",
      "#e1e1e2",
      "#467ef9",
      "#467ef9",
      "#1a1a1a",
      "#046e31",
      "#7a5b01",
      "#a43b38"
    ],
    "dark": [
      "#282c34",
      "#24282e",
      "#292e34",
      "#b4bbc9",
      "#bac1cf",
      "#a7acb6",
      "#3a3f47",
      "#61afef",
      "#61afef",
      "#1a1a1a",
      "#6fd087",
      "#e0af3b",
      "#ff958e"
    ]
  },
  "monokai": {
    "light": [
      "#f2f0e9",
      "#faf9f5",
      "#fdfdfc",
      "#1e1a12",
      "#48453d",
      "#5f5b51",
      "#d6d4cd",
      "#8e7100",
      "#8e7100",
      "#ffffff",
      "#00682d",
      "#6f5406",
      "#9d3532"
    ],
    "dark": [
      "#2d2a2e",
      "#39363a",
      "#434144",
      "#fcfcfa",
      "#ebebea",
      "#d9d7d9",
      "#484549",
      "#ffd866",
      "#ffd866",
      "#1a1a1a",
      "#86e89c",
      "#fecd5c",
      "#fec8c4"
    ]
  },
  "ayu": {
    "light": [
      "#fcfcfc",
      "#f6f7f7",
      "#fafbfc",
      "#4e5358",
      "#585d62",
      "#61686f",
      "#e5e6e7",
      "#f2ae49",
      "#f2ae49",
      "#1a1a1a",
      "#017232",
      "#7d5e07",
      "#a43b38"
    ],
    "dark": [
      "#0b0e14",
      "#10141c",
      "#171b25",
      "#bfbdb6",
      "#b1afa9",
      "#9ba0ac",
      "#222529",
      "#e6b450",
      "#e6b450",
      "#1a1a1a",
      "#6fd087",
      "#e0af3b",
      "#ff958e"
    ]
  },
  "ayu-mirage": {
    "light": [
      "#f3f0e9",
      "#fbf9f5",
      "#fdfdfc",
      "#1e1a12",
      "#49453d",
      "#605a51",
      "#d7d4cd",
      "#946d0a",
      "#946d0a",
      "#ffffff",
      "#00682d",
      "#735601",
      "#9d3532"
    ],
    "dark": [
      "#1f2430",
      "#222734",
      "#2a2f3c",
      "#cccac2",
      "#d2d0c8",
      "#b2bccf",
      "#353a43",
      "#ffcc66",
      "#ffcc66",
      "#1a1a1a",
      "#6fd087",
      "#e0af3b",
      "#ff958e"
    ]
  },
  "kanagawa": {
    "light": [
      "#f2ecbc",
      "#e9e2b4",
      "#ede5b7",
      "#414150",
      "#484854",
      "#585548",
      "#dbd6ae",
      "#4d699b",
      "#4d699b",
      "#ffffff",
      "#05612b",
      "#6c5000",
      "#972e2d"
    ],
    "dark": [
      "#1f1f28",
      "#262631",
      "#2f2f3b",
      "#dcd7ba",
      "#c5c1a8",
      "#b7b29f",
      "#38373b",
      "#7e9cd8",
      "#7e9cd8",
      "#1a1a1a",
      "#6fd087",
      "#e0af3b",
      "#ff958e"
    ]
  },
  "palenight": {
    "light": [
      "#f2eef5",
      "#f9f8fa",
      "#fdfdfe",
      "#1d1820",
      "#48434b",
      "#5e5962",
      "#d6d2d9",
      "#8e5bae",
      "#8e5bae",
      "#ffffff",
      "#03652c",
      "#6f5406",
      "#9d3532"
    ],
    "dark": [
      "#292d3e",
      "#303045",
      "#39384f",
      "#c9d1df",
      "#ccd4e2",
      "#b8c0e0",
      "#3e4253",
      "#c792ea",
      "#c792ea",
      "#1a1a1a",
      "#76d78d",
      "#edbc4b",
      "#feb0aa"
    ]
  },
  "material-ocean": {
    "light": [
      "#edf0f7",
      "#f8f9fb",
      "#fcfdfe",
      "#171b23",
      "#42464d",
      "#565b65",
      "#d1d4db",
      "#4d71c1",
      "#4d71c1",
      "#ffffff",
      "#00682d",
      "#6f5406",
      "#9d3532"
    ],
    "dark": [
      "#0f111a",
      "#161821",
      "#1e202a",
      "#eeffff",
      "#c1cfd1",
      "#9ea2b2",
      "#2c3038",
      "#82aaff",
      "#82aaff",
      "#1a1a1a",
      "#6fd087",
      "#e0af3b",
      "#ff958e"
    ]
  },
  "github": {
    "light": [
      "#ffffff",
      "#f9fafc",
      "#fefefe",
      "#1f2328",
      "#4c4f53",
      "#5a626a",
      "#e2e2e3",
      "#0969da",
      "#0969da",
      "#ffffff",
      "#017232",
      "#7d5e07",
      "#a43b38"
    ],
    "dark": [
      "#0d1117",
      "#13171e",
      "#1a1f27",
      "#e6edf3",
      "#bbc1c7",
      "#919aa4",
      "#292e34",
      "#2f81f7",
      "#2f81f7",
      "#1a1a1a",
      "#6fd087",
      "#e0af3b",
      "#ff958e"
    ]
  },
  "horizon": {
    "light": [
      "#f6eeef",
      "#fbf8f8",
      "#fefdfd",
      "#221719",
      "#4c4244",
      "#615456",
      "#dad2d3",
      "#c7355c",
      "#c7355c",
      "#ffffff",
      "#00682d",
      "#6f5406",
      "#9d3532"
    ],
    "dark": [
      "#1c1e26",
      "#20222c",
      "#282a35",
      "#d5d8da",
      "#b0b3b6",
      "#a0a4be",
      "#34363d",
      "#e95678",
      "#e95678",
      "#1a1a1a",
      "#6fd087",
      "#e0af3b",
      "#ff958e"
    ]
  },
  "synthwave": {
    "light": [
      "#f5eef2",
      "#faf8f9",
      "#fefdfd",
      "#20181d",
      "#4b4348",
      "#5f555b",
      "#d9d2d6",
      "#b73a98",
      "#b73a98",
      "#ffffff",
      "#00682d",
      "#6f5406",
      "#9d3532"
    ],
    "dark": [
      "#262335",
      "#282237",
      "#30283f",
      "#ffffff",
      "#d4d3d7",
      "#a5abd6",
      "#42404f",
      "#ff7edb",
      "#ff7edb",
      "#1a1a1a",
      "#6fd087",
      "#e0af3b",
      "#ff958e"
    ]
  },
  "night-owl": {
    "light": [
      "#fbfbfb",
      "#f4f4f4",
      "#f8f8f8",
      "#403f53",
      "#565667",
      "#57636b",
      "#e3e3e5",
      "#2aa298",
      "#2aa298",
      "#1a1a1a",
      "#046e31",
      "#7a5b01",
      "#a43b38"
    ],
    "dark": [
      "#011627",
      "#072238",
      "#102c44",
      "#d6deeb",
      "#b4becc",
      "#a1b4c3",
      "#1d3040",
      "#82aaff",
      "#82aaff",
      "#1a1a1a",
      "#6fd087",
      "#e0af3b",
      "#ff958e"
    ]
  },
  "poimandres": {
    "light": [
      "#eaf2f0",
      "#f5faf9",
      "#fcfdfd",
      "#121d1a",
      "#3d4845",
      "#525e5b",
      "#ced6d4",
      "#068470",
      "#068470",
      "#ffffff",
      "#00682d",
      "#735601",
      "#9d3532"
    ],
    "dark": [
      "#1b1e28",
      "#212631",
      "#2a2f3b",
      "#bcc2e4",
      "#c9cff1",
      "#b4badc",
      "#303340",
      "#5de4c7",
      "#5de4c7",
      "#1a1a1a",
      "#6fd087",
      "#e0af3b",
      "#ff958e"
    ]
  },
  "vesper": {
    "light": [
      "#f5efea",
      "#faf8f7",
      "#fefdfc",
      "#201913",
      "#4b443e",
      "#625952",
      "#d9d3ce",
      "#9a683c",
      "#9a683c",
      "#ffffff",
      "#00682d",
      "#6f5406",
      "#9d3532"
    ],
    "dark": [
      "#101010",
      "#141414",
      "#1b1b1b",
      "#ffffff",
      "#cfcfcf",
      "#a3a3a3",
      "#2f2f2f",
      "#ffc799",
      "#ffc799",
      "#1a1a1a",
      "#6fd087",
      "#e0af3b",
      "#ff958e"
    ]
  },
  "flexoki": {
    "light": [
      "#fffcf0",
      "#f6f4e9",
      "#faf8ed",
      "#100f0f",
      "#403e3c",
      "#61605b",
      "#e0ddd3",
      "#bc5215",
      "#bc5215",
      "#ffffff",
      "#046e31",
      "#7a5b01",
      "#a43b38"
    ],
    "dark": [
      "#100f0f",
      "#171616",
      "#201f1e",
      "#cecdc3",
      "#a8a79f",
      "#9c9a95",
      "#292826",
      "#da702c",
      "#da702c",
      "#1a1a1a",
      "#6fd087",
      "#e0af3b",
      "#ff958e"
    ]
  },
  "oceanic": {
    "light": [
      "#ebf1f6",
      "#f7f9fb",
      "#fcfdfe",
      "#151b22",
      "#40464c",
      "#545c64",
      "#cfd5da",
      "#4678a9",
      "#4678a9",
      "#ffffff",
      "#00682d",
      "#735601",
      "#9d3532"
    ],
    "dark": [
      "#1b2b34",
      "#2b363f",
      "#364049",
      "#d8dee9",
      "#d0d7e2",
      "#b8c7d5",
      "#34424c",
      "#6699cc",
      "#6699cc",
      "#1a1a1a",
      "#82e499",
      "#fac85a",
      "#fdbfb9"
    ]
  },
  "nightfox": {
    "light": [
      "#f6f2ee",
      "#f5efe7",
      "#faf4eb",
      "#3d2b5a",
      "#57476f",
      "#5d5751",
      "#ded8db",
      "#2848a9",
      "#2848a9",
      "#ffffff",
      "#076b30",
      "#735601",
      "#9e3532"
    ],
    "dark": [
      "#192330",
      "#1e2a39",
      "#263343",
      "#cdcecf",
      "#c2c4c5",
      "#a9b5c6",
      "#303945",
      "#719cd6",
      "#719cd6",
      "#1a1a1a",
      "#6fd087",
      "#e0af3b",
      "#ff9b94"
    ]
  }
};
