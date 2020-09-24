/* Copyright 2020 Qlever LLC
 *
 * Licensed under the Apache License, Version 2.0 (the 'License');
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *     http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an 'AS IS' BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */

//domain: 'proxy',
export default {
  domain: 'proxy',
  token: 'god-proxy',
  timeout: 5 * 60 * 1000, // 30 seconds
  slackposturl: 'https://example.com', // use a real slack webhook URL
  skin: 'default', // used for abalonemail job creation
  dailyDigestTime: 8
}
