export type LivelyVoiceGender = "female" | "male" | "neutral";

export type LivelyVoiceOption = {
  id: string;
  value: string;
  label: string;
  gender: LivelyVoiceGender;
};

export const livelyVoiceOptions: LivelyVoiceOption[] = [
  {
    id: "default",
    value: "default",
    label: "Auto",
    gender: "neutral",
  },
  {
    id: "ermil",
    value: "ermil",
    label: "Ermil",
    gender: "male",
  },
  {
    id: "jane",
    value: "jane",
    label: "Jane",
    gender: "female",
  },
  {
    id: "alyss",
    value: "alyss",
    label: "Alyss",
    gender: "female",
  },
  {
    id: "zahar",
    value: "zahar",
    label: "Zahar",
    gender: "male",
  },
  {
    id: "omazh",
    value: "omazh",
    label: "Omazh",
    gender: "male",
  },
];
