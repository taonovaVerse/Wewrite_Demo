// gray-matter 未随包带类型、@types 也不存在，补一个最小声明（只覆盖本项目用到的 API）
declare module 'gray-matter' {
  interface GrayMatterFile {
    data: Record<string, unknown>;
    content: string;
  }

  interface GrayMatterOptions {
    language?: string;
    delimiters?: string | [string, string];
    excerpt?: boolean | string | ((input: string) => string);
  }

  function matter(
    input: string | Buffer,
    options?: GrayMatterOptions,
  ): GrayMatterFile;

  namespace matter {
    function stringify(
      content: string | Buffer,
      data?: Record<string, unknown>,
      options?: GrayMatterOptions,
    ): string;
  }

  export = matter;
}
