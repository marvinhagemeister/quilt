import {CacheControl, ContentSecurityPolicy} from '@quilted/quilt/http';
import {describe, it, expect} from '@quilted/quilt/testing';

import {mountWithAppContext} from '~/tests/mount';

import {Http} from './Http';

describe('<Http />', () => {
  it('does not cache the response', () => {
    const http = mountWithAppContext(<Http />);

    expect(http).toContainReactComponent(CacheControl, {
      cache: false,
    });
  });

  it('adds a content security policy with a strict default policy', () => {
    const http = mountWithAppContext(<Http />);

    expect(http).toContainReactComponent(ContentSecurityPolicy, {
      defaultSources: ["'self'"],
    });
  });
});
