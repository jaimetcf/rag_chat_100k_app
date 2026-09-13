export type SessionItem = {
  id: string;
  title: string;
  title_short: string;
  updated_at: string;
  created_at: string;
  updated_display: string;
};

export type ThreadMessage = {
  id: string;
  role: "user" | "assistant";
  content: string;
  created_at: string;
  time_display: string;
};
