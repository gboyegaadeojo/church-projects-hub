import { useQuery } from "@tanstack/react-query";
import {
  BookOpen,
  Calendar,
  Camera,
  Coffee,
  Baby,
  Folder,
  HeartHandshake,
  type LucideIcon,
  Megaphone,
  MessageSquare,
  Mic,
  Monitor,
  Music,
  Users,
  Utensils,
  Video,
  Wrench,
} from "lucide-react";
import { projectListResponse, type ProjectColour, type ProjectIcon } from "../../shared/projects";
import { api } from "./api";

// Projects on the client: the signed-in person's list, and how a project's colour and icon render.

export const PROJECTS_KEY = ["projects", "mine"] as const;

/** The projects this person can see (sidebar, Projects page, My Work). Refetched on focus, never polled. */
export function useMyProjects() {
  return useQuery({
    queryKey: PROJECTS_KEY,
    queryFn: async () => projectListResponse.parse(await api("/api/projects")).projects,
  });
}

export const PROJECT_ICON_COMPONENTS: Record<ProjectIcon, LucideIcon> = {
  folder: Folder,
  video: Video,
  music: Music,
  mic: Mic,
  monitor: Monitor,
  camera: Camera,
  baby: Baby,
  coffee: Coffee,
  utensils: Utensils,
  wrench: Wrench,
  "heart-handshake": HeartHandshake,
  megaphone: Megaphone,
  "book-open": BookOpen,
  users: Users,
  calendar: Calendar,
  "message-square": MessageSquare,
};

export const PROJECT_ICON_LABELS: Record<ProjectIcon, string> = {
  folder: "Folder",
  video: "Video",
  music: "Music",
  mic: "Microphone",
  monitor: "Screen",
  camera: "Camera",
  baby: "Children",
  coffee: "Coffee",
  utensils: "Meals",
  wrench: "Tools",
  "heart-handshake": "Care",
  megaphone: "Announcements",
  "book-open": "Book",
  users: "People",
  calendar: "Calendar",
  "message-square": "Messages",
};

/** Full class names so Tailwind finds them: text and background in each project colour token. */
export const PROJECT_COLOUR_CLASSES: Record<ProjectColour, { text: string; bg: string; label: string }> = {
  blue: { text: "text-project-blue", bg: "bg-project-blue", label: "Blue" },
  teal: { text: "text-project-teal", bg: "bg-project-teal", label: "Teal" },
  green: { text: "text-project-green", bg: "bg-project-green", label: "Green" },
  amber: { text: "text-project-amber", bg: "bg-project-amber", label: "Amber" },
  orange: { text: "text-project-orange", bg: "bg-project-orange", label: "Orange" },
  red: { text: "text-project-red", bg: "bg-project-red", label: "Red" },
  pink: { text: "text-project-pink", bg: "bg-project-pink", label: "Pink" },
  purple: { text: "text-project-purple", bg: "bg-project-purple", label: "Purple" },
};
