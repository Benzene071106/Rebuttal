// The dashboard the "Ask AI" page opens with, so a visitor sees an answer before asking
// anything. It was built by AG Studio's agents on Gemini from two prompts ("three KPIs:
// total Amount, Kept and Refunded" and "a stacked column chart of Kept and Refunded by
// Claim") and saved with api.getState(). The space below is left for the visitor's questions.
export const DEFAULT_REPORT: unknown = {
  "pages": [
    {
      "id": "page-1",
      "widgets": {
        "kpi_amount": {
          "type": "value",
          "format": {
            "style": {
              "label": {
                "enabled": true
              }
            }
          },
          "dataMapping": {
            "value": [
              {
                "id": "disputes.amount",
                "aggregation": "sum"
              }
            ]
          }
        },
        "kpi_kept": {
          "type": "value",
          "format": {
            "style": {
              "label": {
                "enabled": true
              }
            }
          },
          "dataMapping": {
            "value": [
              {
                "id": "disputes.kept",
                "aggregation": "sum"
              }
            ]
          }
        },
        "kpi_refunded": {
          "type": "value",
          "format": {
            "style": {
              "label": {
                "enabled": true
              }
            }
          },
          "dataMapping": {
            "value": [
              {
                "id": "disputes.refunded",
                "aggregation": "sum"
              }
            ]
          }
        },
        "stacked_column_chart": {
          "type": "column-chart-stacked",
          "dataMapping": {
            "categoryKey": [
              {
                "id": "disputes.claim"
              }
            ],
            "valueKey": [
              {
                "id": "disputes.kept",
                "aggregation": "sum"
              },
              {
                "id": "disputes.refunded",
                "aggregation": "sum"
              }
            ]
          }
        }
      },
      "widgetLayout": {
        "kpi_amount": {
          "xTrack": 0,
          "yTrack": 0,
          "xSpan": 8,
          "ySpan": 6
        },
        "kpi_kept": {
          "xTrack": 8,
          "yTrack": 0,
          "xSpan": 8,
          "ySpan": 6
        },
        "kpi_refunded": {
          "xTrack": 16,
          "yTrack": 0,
          "xSpan": 8,
          "ySpan": 6
        },
        "stacked_column_chart": {
          "xTrack": 0,
          "yTrack": 6,
          "xSpan": 24,
          "ySpan": 18
        }
      }
    }
  ],
  "selectedPageId": "page-1",
  "version": "3.1.0"
};
