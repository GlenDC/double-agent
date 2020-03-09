import axios from 'axios';
import IBrowserstackAgent from '../interfaces/IBrowserstackAgent';
import webdriver from 'selenium-webdriver';

export default class BrowserStack {
  static supportedCapabilities = [];

  public static async buildWebDriver(browser: IBrowserstackAgent) {
    try {
      return await new webdriver.Builder()
        .usingServer('http://hub-cloud.browserstack.com/wd/hub')
        .withCapabilities({
          ...browser,
          ...browserstackSettings,
        })
        .build();
    } catch (err) {
      console.log("Couldn't build driver for %s", browser);
    }

    return null;
  }

  public static async isBrowserSupported(agent: IBrowserstackAgent) {
    const { os, os_version, browser_version, browserName } = agent;
    const capabilities = await BrowserStack.getCapabilities();
    return capabilities.find(x => {
      return (
        x.os === os &&
        x.os_version === os_version &&
        x.browser === browserName.toLowerCase() &&
        (x.browser_version === browser_version || x.browser_version === browser_version + '.0')
      );
    });
  }

  static async getCapabilities() {
    if (!BrowserStack.supportedCapabilities.length) {
      BrowserStack.supportedCapabilities = await axios
        .get('https://api.browserstack.com/automate/browsers.json', {
          auth: {
            password: browserstackSettings['browserstack.key'],
            username: browserstackSettings['browserstack.user'],
          },
        })
        .then(x => x.data);
    }
    return BrowserStack.supportedCapabilities;
  }
}

const browserstackSettings = {
  resolution: '1024x768',
  'browserstack.user': process.env.BROWSERSTACK_USER,
  'browserstack.key': process.env.BROWSERSTACK_KEY,
  'browserstack.safari.allowAllCookies': 'true',
  buildName: 'Profiles',
  projectName: 'Double Agent',
};
