const { ApplicationV2, HandlebarsApplicationMixin } = foundry.applications.api;

export class ItemGeneratorApp extends HandlebarsApplicationMixin(ApplicationV2) {
  constructor(item, options = {}) {
    super(options);
    this.item = item;
  }

  static DEFAULT_OPTIONS = {
    id: "simsala-item-generator",
    window: {
      title: "Generate Item",
      resizable: true,
    },
    position: {
      width: 500,
      height: 600,
    },
  };

  static PARTS = {
    main: {
      template: "modules/simsala/templates/item-generator.hbs",
    },
  };

  get title() {
    return `Generate: ${this.item.name}`;
  }

  async _prepareContext(options) {
    return {
      itemName: this.item.name,
    };
  }
}
