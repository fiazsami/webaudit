/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/.
 *
 * Copied from @mdn/mdn-http-observatory v1.7.1. See ./README.md (or ../vendor/README.md)
 * for the list of changes. */

import { X_CONTENT_TYPE_OPTIONS } from "../headers.js";
import { BaseOutput, Expectation } from "../types.js";
import { getFirstHttpHeader } from "../utils.js";

/** @import { Requests } from "../types.js" */

export class XContentTypeOptionsOutput extends BaseOutput {
  /** @type {string | null} */
  data = null;
  static name = "x-content-type-options";
  static title = "X-Content-Type-Options";
  static possibleResults = [
    Expectation.XContentTypeOptionsNosniff,
    Expectation.XContentTypeOptionsHeaderInvalid,
    Expectation.XContentTypeOptionsNotImplemented,
  ];
}

/**
 *
 * @param {Requests} requests
 * @param {Expectation} expectation
 * @returns {XContentTypeOptionsOutput}
 */
export function xContentTypeOptionsTest(
  requests,
  expectation = Expectation.XContentTypeOptionsNosniff
) {
  const output = new XContentTypeOptionsOutput(expectation);
  const resp = requests.responses.auto;

  if (!resp) {
    output.result = Expectation.XContentTypeOptionsNotImplemented;
    return output;
  }

  const header = getFirstHttpHeader(resp, X_CONTENT_TYPE_OPTIONS);

  if (header) {
    output.data = header.slice(0, 256);
    if (output.data.trim().toLowerCase() === "nosniff") {
      output.result = Expectation.XContentTypeOptionsNosniff;
    } else {
      output.result = Expectation.XContentTypeOptionsHeaderInvalid;
    }
  } else {
    output.result = Expectation.XContentTypeOptionsNotImplemented;
  }

  // Check to see if the test passed or failed
  output.pass = output.result === expectation;
  return output;
}
