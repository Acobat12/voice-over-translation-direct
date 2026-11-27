export type LivelyVoiceGender = "female" | "male" | "neutral";

export type LivelyVoiceOption = {
  id: string;
  value: string;
  label: string;
  gender: LivelyVoiceGender;
};

export const livelyVoiceOptions: LivelyVoiceOption[] = [
  // Original VOT choices
  { id: "default", value: "default", label: "Auto", gender: "neutral" },
  { id: "ermil", value: "ermil", label: "Ermil", gender: "male" },
  { id: "jane", value: "jane", label: "Jane", gender: "female" },
  { id: "alyss", value: "alyss", label: "Alyss", gender: "female" },
  { id: "zahar", value: "zahar", label: "Zahar", gender: "male" },
  { id: "omazh", value: "omazh", label: "Omazh", gender: "male" },

  // Additional SpeechKit general voices; compatibility with VOT unverified
  { id: "filipp", value: "filipp", label: "Filipp", gender: "male" },
  { id: "dasha", value: "dasha", label: "Dasha", gender: "female" },
  { id: "julia", value: "julia", label: "Julia", gender: "female" },
  { id: "lera", value: "lera", label: "Lera", gender: "female" },
  { id: "masha", value: "masha", label: "Masha", gender: "female" },
  { id: "marina", value: "marina", label: "Marina", gender: "female" },
  { id: "alexander", value: "alexander", label: "Alexander", gender: "male" },
  { id: "kirill", value: "kirill", label: "Kirill", gender: "male" },
  { id: "anton", value: "anton", label: "Anton", gender: "male" },
  { id: "madi_ru", value: "madi_ru", label: "Madi (RU)", gender: "male" },
  { id: "saule_ru", value: "saule_ru", label: "Saule (RU)", gender: "female" },
  {
    id: "zamira_ru",
    value: "zamira_ru",
    label: "Zamira (RU)",
    gender: "female",
  },
  {
    id: "zhanar_ru",
    value: "zhanar_ru",
    label: "Zhanar (RU)",
    gender: "female",
  },
  {
    id: "yulduz_ru",
    value: "yulduz_ru",
    label: "Yulduz (RU)",
    gender: "female",
  },

  // Additional LiveTTS voices; compatibility with VOT unverified
  { id: "sofia", value: "sofia", label: "Sofia", gender: "female" },
  { id: "vera", value: "vera", label: "Vera", gender: "female" },
  { id: "vasily", value: "vasily", label: "Vasily", gender: "male" },
  { id: "sergey", value: "sergey", label: "Sergey", gender: "male" },
  { id: "denis", value: "denis", label: "Denis", gender: "male" },
  { id: "irina", value: "irina", label: "Irina", gender: "female" },
];
