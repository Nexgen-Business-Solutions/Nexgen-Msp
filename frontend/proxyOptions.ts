import commonSiteConfig from '../../../sites/common_site_config.json';

const { webserver_port: webserverPort } = commonSiteConfig;

export default {
  '^/(app|api|assets|files|private)': {
    target: `http://127.0.0.1:${webserverPort}`,
    ws: true,
    router: function (req: { headers: { host: string } }) {
      const siteName = req.headers.host.split(':')[0];
      return `http://${siteName}:${webserverPort}`;
    },
  },
};
