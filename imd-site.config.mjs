export default {
  content: "web",
  output: "web.static",
  static: "static",
  layouts: "layouts",
  site: {
    title: "Roberto Montalti",
    url: "https://rmontalti.com",
    basePath: "/",
    language: "en",
  },
  packs: ["@imd/art"],
  render: {
    ground: "full-black",
    typeface: "book",
  },
  headingIdOverrides: {
    "/posts/quadtrees.html": {
      "2d-collision-detection": "d-collision-detection",
      "we-ll-be-creating": "well-be-creating",
    },
  },
};
