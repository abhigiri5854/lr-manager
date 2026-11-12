import type { ChipTone } from "@/components/ui/Chip";
import type { TripEventType } from "@/lib/types";

export const TRIP_LABEL: Record<TripEventType, string> = {
  loaded: "Loaded",
  en_route: "On the way",
  reached: "Reached",
};

export const TRIP_TONE: Record<TripEventType, ChipTone> = {
  loaded: "amber",
  en_route: "blue",
  reached: "green",
};
