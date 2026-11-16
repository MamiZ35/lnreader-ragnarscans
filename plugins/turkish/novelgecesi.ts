import { load as parseHTML } from 'cheerio';
import { fetchApi } from '@libs/fetch';
import { Plugin } from '@/types/plugin';
import { FilterTypes, Filters } from '@libs/filterInputs';
import { defaultCover } from '@libs/defaultCover';
import { NovelStatus } from '@libs/novelStatus';

class NovelGecesiPlugin implements Plugin.PluginBase {
  id = 'novelgecesi';
  name = 'Novel Gecesi MZ';
  icon = 'src/tr/novelgecesi/icon.png';
  site = 'https://www.novelgecesi.com/';
  version = '1.0.0';

  filters = {
    sort: {
      label: 'Sıralama',
      value: 'popular',
      type: FilterTypes.Picker,
      options: [
        { label: 'Popüler', value: 'popular' },
        { label: 'En Çok Okunan', value: 'most-read' },
        { label: 'En Az Okunan', value: 'least-read' },
        { label: 'En Yeni', value: 'newest' },
        { label: 'En Eski', value: 'oldest' },
        { label: 'Puan', value: 'rating' },
      ],
    },
    status: {
      label: 'Durum',
      value: 'all',
      type: FilterTypes.Picker,
      options: [
        { label: 'Tümü', value: 'all' },
        { label: 'Devam Ediyor', value: 'Devam Ediyor' },
        { label: 'Tamamlandı', value: 'Tamamlandı' },
        { label: 'Askıda', value: 'Askıda' },
        { label: 'Bırakıldı', value: 'Bırakıldı' },
      ],
    },
    categories: {
      label: 'Kategoriler',
      value: [],
      type: FilterTypes.CheckboxGroup,
      options: [
        { label: 'Aksiyon', value: 'Aksiyon' },
        { label: 'Bilim Kurgu', value: 'Bilim Kurgu' },
        { label: 'Büyü', value: 'Büyü' },
        { label: 'Doğaüstü', value: 'Doğaüstü' },
        { label: 'Dövüş Sanatları', value: 'Dövüş Sanatları' },
        { label: 'Dram', value: 'Dram' },
        { label: 'Fantastik', value: 'Fantastik' },
        { label: 'Gizem', value: 'Gizem' },
        { label: 'Harem', value: 'Harem' },
        { label: 'Isekai', value: 'Isekai' },
        { label: 'Komedi', value: 'Komedi' },
        { label: 'Korku', value: 'Korku' },
        { label: 'Kültivasyon', value: 'Kültivasyon' },
        { label: 'Macera', value: 'Macera' },
        { label: 'Psikolojik', value: 'Psikolojik' },
        { label: 'Reenkarnasyon', value: 'Reenkarnasyon' },
        { label: 'Romantik', value: 'Romantik' },
        { label: 'Romantizm', value: 'Romantizm' },
        { label: 'Seinen', value: 'Seinen' },
        { label: 'Shounen', value: 'Shounen' },
        { label: 'Tarihi', value: 'Tarihi' },
        { label: 'Wuxia', value: 'Wuxia' },
        { label: 'Xianxia', value: 'Xianxia' },
        { label: 'Xuanhuan', value: 'Xuanhuan' },
      ],
    },
  } satisfies Filters;

  private stripSite(url: string): string {
    return url.replace(this.site, '').replace(/^\/+/, '');
  }

  private async fetchChecked(url: string): Promise<string> {
    const res = await fetchApi(url);
    const body = await res.text();
    if (
      res.status === 403 ||
      body.includes('<title>Just a moment...</title>') ||
      body.includes('cf-mitigated')
    ) {
      throw new Error(
        'Cloudflare doğrulaması gerekli. LNReader WebView üzerinden novelgecesi.com sitesini açıp doğrulamayı geçin.',
      );
    }
    return body;
  }

  async popularNovels(
    pageNo: number,
    {
      showLatestNovels,
      filters,
    }: Plugin.PopularNovelsOptions<typeof this.filters>,
  ): Promise<Plugin.NovelItem[]> {
    const params = new URLSearchParams();
    params.set('page', String(pageNo));
    params.set(
      'sort',
      showLatestNovels ? 'newest' : filters?.sort?.value || 'popular',
    );

    if (filters?.status?.value && filters.status.value !== 'all') {
      params.set('status', filters.status.value);
    }
    if (filters?.categories?.value?.length) {
      for (const category of filters.categories.value) {
        params.append('categories', category);
      }
    }

    const url = `${this.site}seriler?${params.toString()}`;
    const body = await this.fetchChecked(url);
    const $ = parseHTML(body);

    const novels: Plugin.NovelItem[] = [];
    $('.series-card').each((_, el) => {
      const card = $(el);
      const link = card.find('h3.series-title a').first();
      const name = link.text().trim();
      const href = link.attr('href');
      if (!name || !href) return;

      const img = card.find('.series-image img').first();
      const cover = img.attr('src') || img.attr('data-src') || defaultCover;

      novels.push({
        name,
        path: this.stripSite(href),
        cover,
      });
    });

    return novels;
  }

  async parseNovel(novelPath: string): Promise<Plugin.SourceNovel> {
    const cleanPath = this.stripSite(novelPath);
    const url = `${this.site}${cleanPath}`;
    const body = await this.fetchChecked(url);
    const $ = parseHTML(body);

    const novel: Plugin.SourceNovel = {
      path: cleanPath,
      name: $('h1').first().text().trim() || 'Untitled',
      cover:
        $('meta[property="og:image"]').attr('content') ||
        $('.series-image img').first().attr('src') ||
        defaultCover,
    };

    const author = $('.series-author-uploader').first().text().trim();
    if (author) {
      novel.author = author;
    }

    const summary = $('.series-description').first().text().trim();
    if (summary) {
      novel.summary = summary;
    }

    const genres = $('.series-genres .genre-tag')
      .map((_, el) => $(el).text().trim())
      .get()
      .filter(Boolean);
    if (genres.length) {
      novel.genres = genres.join(', ');
    }

    const statusText = $('.series-status').first().text().trim().toLowerCase();
    if (statusText.includes('devam')) {
      novel.status = NovelStatus.Ongoing;
    } else if (statusText.includes('tamam')) {
      novel.status = NovelStatus.Completed;
    } else if (statusText.includes('askı')) {
      novel.status = NovelStatus.OnHiatus;
    } else if (statusText.includes('bırak')) {
      novel.status = NovelStatus.Cancelled;
    } else {
      novel.status = NovelStatus.Unknown;
    }

    let $chapters = $;
    const loadMoreHref = $('a#load-more-api').attr('href');
    if (loadMoreHref) {
      try {
        const allBody = await this.fetchChecked(loadMoreHref.split('#')[0]);
        const $all = parseHTML(allBody);
        if ($all('.episode-item').length >= $('.episode-item').length) {
          $chapters = $all;
        }
      } catch {
        // Keep initial page chapters if load-more fails
      }
    }

    const chapters: Plugin.ChapterItem[] = [];
    $chapters('.episode-item').each((_, el) => {
      const item = $chapters(el);
      const link = item.find('a.episode-link').first();
      const href = link.attr('href');
      const name = item.find('.episode-title').first().text().trim();
      if (!href || !name) return;

      const chNoRaw = item.attr('data-chapter-no');
      const chNo = chNoRaw !== undefined ? Number(chNoRaw) : undefined;

      chapters.push({
        name,
        path: this.stripSite(href),
        chapterNumber: Number.isFinite(chNo) ? chNo : undefined,
      });
    });

    novel.chapters = chapters;
    return novel;
  }

  async parseChapter(chapterPath: string): Promise<string> {
    const url = `${this.site}${this.stripSite(chapterPath)}`;
    const body = await this.fetchChecked(url);
    const $ = parseHTML(body);

    const content = $(
      '#reader-content, #novel-content, article.novel-content',
    ).first();
    content.find('script, style').remove();
    return content.html() || '';
  }

  async searchNovels(
    searchTerm: string,
    pageNo: number,
  ): Promise<Plugin.NovelItem[]> {
    const params = new URLSearchParams();
    params.set('q', searchTerm);
    params.set('page', String(pageNo));
    const url = `${this.site}seriler?${params.toString()}`;

    const body = await this.fetchChecked(url);
    const $ = parseHTML(body);

    const novels: Plugin.NovelItem[] = [];
    $('.series-card').each((_, el) => {
      const card = $(el);
      const link = card.find('h3.series-title a').first();
      const name = link.text().trim();
      const href = link.attr('href');
      if (!name || !href) return;

      const img = card.find('.series-image img').first();
      const cover = img.attr('src') || img.attr('data-src') || defaultCover;

      novels.push({
        name,
        path: this.stripSite(href),
        cover,
      });
    });

    return novels;
  }

  resolveUrl = (path: string) => `${this.site}${this.stripSite(path)}`;
}

export default new NovelGecesiPlugin();
