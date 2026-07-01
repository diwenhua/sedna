export interface WebSearchResultItem {
  title: string;
  url: string;
  snippet: string;
}

export interface WebSearchResponse {
  success: boolean;
  provider: string;
  query: string;
  results: WebSearchResultItem[];
  error?: string;
}

export interface WebFetchResponse {
  success: boolean;
  url: string;
  title?: string;
  content: string;
  truncated: boolean;
  error?: string;
}
