import {
  FileBraces,
  FileCode,
  FileText,
  Folder,
  FolderOpen,
  Image,
  Languages,
  type LucideIcon,
} from "lucide-react";
import type { Language } from "../lib/types";

const byLanguage: Record<Language, { icon: LucideIcon; tone: string }> = {
  json: { icon: FileBraces, tone: "json" },
  javascript: { icon: FileCode, tone: "js" },
  typescript: { icon: FileCode, tone: "ts" },
  lang: { icon: Languages, tone: "lang" },
  markdown: { icon: FileText, tone: "md" },
  image: { icon: Image, tone: "image" },
  plaintext: { icon: FileText, tone: "text" },
};

interface FileIconProps {
  language?: Language;
  directory?: boolean;
  open?: boolean;
  size?: number;
}

export function FileIcon({ language = "plaintext", directory, open, size = 15 }: FileIconProps) {
  if (directory) {
    const Icon = open ? FolderOpen : Folder;
    return <Icon size={size} className="file-icon tone-folder" strokeWidth={1.75} />;
  }
  const { icon: Icon, tone } = byLanguage[language];
  return <Icon size={size} className={`file-icon tone-${tone}`} strokeWidth={1.75} />;
}
