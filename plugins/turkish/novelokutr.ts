import { load as parseHTML } from 'cheerio';
import { fetchApi } from '@libs/fetch';
import { Plugin } from '@/types/plugin';
import { FilterTypes, Filters } from '@libs/filterInputs';
import { defaultCover } from '@libs/defaultCover';
import { NovelStatus } from '@libs/novelStatus';

class NovelOkuTRPlugin implements Plugin.PluginBase {
  id = 'novelokutr';
  name = 'NovelOkuTR MZ';
  icon = 'src/tr/novelokutr/icon.png';
  site = 'https://novelokutr.net/';
  version = '1.0.1';

  filters = {
    orderBy: {
      label: 'Sıralama',
      value: 'views',
      type: FilterTypes.Picker,
      options: [
        { label: 'En Çok Okunan', value: 'views' },
        { label: 'Son Güncellenen', value: 'latest' },
        { label: 'Yeni Eklenen', value: 'new-manga' },
        { label: 'Puan', value: 'rating' },
        { label: 'A-Z', value: 'alphabet' },
        { label: 'Trend', value: 'trending' },
      ],
    },
  } satisfies Filters;

  private stripSite(url: string): string {
    return url.replace(this.site, '').replace(/^\/+/, '');
  }

  private extractCover(el: ReturnType<ReturnType<typeof parseHTML>>): string {
    const img = el.find('img').first();
    return (
      img.attr('data-src') ||
      img.attr('data-lazy-src') ||
      img.attr('src') ||
      defaultCover
    );
  }

  async popularNovels(
    pageNo: number,
    {
      showLatestNovels,
      filters,
    }: Plugin.PopularNovelsOptions<typeof this.filters>,
  ): Promise<Plugin.NovelItem[]> {
    const orderBy = showLatestNovels
      ? 'latest'
      : filters?.orderBy?.value || 'views';
    const pageSegment = pageNo > 1 ? `sayfa/${pageNo}/` : '';
    const url = `${this.site}manga/${pageSegment}?m_orderby=${orderBy}`;

    const res = await fetchApi(url);
    const body = await res.text();
    const $ = parseHTML(body);

    const novels: Plugin.NovelItem[] = [];
    $('.page-item-detail').each((_, el) => {
      const card = $(el);
      const link = card.find(
        '.post-title h3 a, .post-title h5 a, .post-title a',
      );
      const name = link.first().text().trim();
      const href = link.first().attr('href');
      if (!name || !href) return;

      novels.push({
        name,
        path: this.stripSite(href),
        cover: this.extractCover(card),
      });
    });

    return novels;
  }

  async parseNovel(novelPath: string): Promise<Plugin.SourceNovel> {
    const cleanPath = this.stripSite(novelPath);
    const url = `${this.site}${cleanPath}`;
    const res = await fetchApi(url);
    const body = await res.text();
    const $ = parseHTML(body);

    const novel: Plugin.SourceNovel = {
      path: cleanPath,
      name: $('h1').first().text().trim() || 'Untitled',
      cover: this.extractCover($('.summary_image')),
    };

    const summary = $('.summary__content p')
      .map((_, el) => $(el).text().trim())
      .get()
      .filter(Boolean)
      .join('\n\n');
    if (summary) {
      novel.summary = summary;
    }

    const genres = $('.genres-content a')
      .map((_, el) => $(el).text().trim())
      .get()
      .filter(Boolean);
    if (genres.length) {
      novel.genres = genres.join(', ');
    }

    const author = $('.author-content a')
      .map((_, el) => $(el).text().trim())
      .get()
      .filter(Boolean)
      .join(', ');
    if (author) {
      novel.author = author;
    }

    const statusText = $('.post-status .summary-content')
      .last()
      .text()
      .trim()
      .toLowerCase();
    if (statusText.includes('devam') || statusText.includes('ongoing')) {
      novel.status = NovelStatus.Ongoing;
    } else if (
      statusText.includes('tamam') ||
      statusText.includes('completed')
    ) {
      novel.status = NovelStatus.Completed;
    } else if (statusText.includes('ara') || statusText.includes('hiatus')) {
      novel.status = NovelStatus.OnHiatus;
    } else {
      novel.status = NovelStatus.Unknown;
    }

    const chaptersUrl = `${url.replace(/\/+$/, '')}/ajax/chapters/`;
    const chRes = await fetchApi(chaptersUrl, { method: 'POST' });
    const chBody = await chRes.text();
    const $ch = parseHTML(chBody);

    const chapters: Plugin.ChapterItem[] = [];
    $ch('li.wp-manga-chapter').each((_, el) => {
      const item = $ch(el);
      const link = item.find('a').first();
      const name = link.text().trim();
      const href = link.attr('href');
      if (!name || !href) return;

      const releaseTime = item.find('.chapter-release-date i').text().trim();
      chapters.push({
        name,
        path: this.stripSite(href),
        releaseTime: releaseTime || undefined,
      });
    });

    novel.chapters = chapters.reverse();
    return novel;
  }

  async parseChapter(chapterPath: string): Promise<string> {
    const url = `${this.site}${this.stripSite(chapterPath)}`;
    const res = await fetchApi(url);
    const body = await res.text();
    const $ = parseHTML(body);

    const content = $('.reading-content .text-left, .reading-content').first();
    content.find('script, style, .ads, .code-block').remove();
    return content.html() || '';
  }

  async searchNovels(
    searchTerm: string,
    pageNo: number,
  ): Promise<Plugin.NovelItem[]> {
    const pageSegment = pageNo > 1 ? `sayfa/${pageNo}/` : '';
    const url = `${this.site}${pageSegment}?s=${encodeURIComponent(
      searchTerm,
    )}&post_type=wp-manga`;

    const res = await fetchApi(url);
    const body = await res.text();
    const $ = parseHTML(body);

    const novels: Plugin.NovelItem[] = [];
    $('.c-tabs-item__content').each((_, el) => {
      const card = $(el);
      const link = card.find(
        '.post-title h3 a, .post-title h4 a, .post-title a',
      );
      const name = link.first().text().trim();
      const href = link.first().attr('href');
      if (!name || !href) return;

      novels.push({
        name,
        path: this.stripSite(href),
        cover: this.extractCover(card),
      });
    });

    return novels;
  }

  resolveUrl = (path: string) => `${this.site}${this.stripSite(path)}`;
}

export default new NovelOkuTRPlugin();
