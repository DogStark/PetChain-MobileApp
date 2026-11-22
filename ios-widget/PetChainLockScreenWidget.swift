//
//  PetChainLockScreenWidget.swift
//  PetChainWidget
//
//  iOS 16+ lock screen widget showing today's next pending medication dose
//  (#1395). Reads the same App Group data written by widgetService.ts.
//

import WidgetKit
import SwiftUI
import Foundation

// MARK: - Next dose selection

struct NextDose {
    let petName: String
    let medicationName: String
    let doseTime: Date?
    let deepLink: URL?

    var timeText: String {
        guard let doseTime else { return "Today" }
        return DateFormatter.localizedString(from: doseTime, dateStyle: .none, timeStyle: .short)
    }
}

private func parseISODate(_ value: String?) -> Date? {
    guard let value else { return nil }
    let withFraction = ISO8601DateFormatter()
    withFraction.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
    return withFraction.date(from: value) ?? ISO8601DateFormatter().date(from: value)
}

/// The soonest dose of today that has not been taken yet.
func nextPendingDose(from data: WidgetDataModel?) -> NextDose? {
    guard let data else { return nil }
    let pending = data.medications
        .filter { !$0.taken }
        .sorted { (parseISODate($0.scheduledTime) ?? .distantFuture) < (parseISODate($1.scheduledTime) ?? .distantFuture) }
    guard let item = pending.first else { return nil }
    let link = item.deepLink.flatMap(URL.init(string:))
        ?? URL(string: "petchain://doses/\(item.petId)/\(item.medicationId)")
    return NextDose(
        petName: item.petName,
        medicationName: item.medicationName,
        doseTime: parseISODate(item.scheduledTime),
        deepLink: link
    )
}

// MARK: - Views

struct PetChainLockScreenEntryView: View {
    @Environment(\.widgetFamily) var widgetFamily
    let entry: PetChainWidgetProvider.Entry

    /// Honors the sensitive-data preference: details are hidden while locked
    /// and in previews when hideDetailsOnLockScreen is on (default).
    private var hideDetails: Bool {
        entry.widgetData?.hideDetailsOnLockScreen ?? true
    }

    var body: some View {
        let dose = nextPendingDose(from: entry.widgetData)
        content(for: dose)
            .widgetURL(dose?.deepLink ?? URL(string: "petchain://"))
    }

    @ViewBuilder
    private func content(for dose: NextDose?) -> some View {
        switch widgetFamily {
        case .accessoryInline:
            if let dose {
                Label {
                    Text("\(dose.medicationName) · \(dose.timeText)")
                        .privacySensitive(hideDetails)
                } icon: {
                    Image(systemName: "pills.fill")
                }
            } else {
                Label("No doses due", systemImage: "checkmark.circle")
            }
        case .accessoryCircular:
            ZStack {
                AccessoryWidgetBackground()
                VStack(spacing: 0) {
                    Image(systemName: dose == nil ? "checkmark" : "pills.fill")
                        .font(.caption)
                    if let dose {
                        Text(dose.timeText)
                            .font(.system(size: 10, weight: .semibold))
                            .minimumScaleFactor(0.6)
                            .lineLimit(1)
                    }
                }
            }
        default:
            VStack(alignment: .leading, spacing: 1) {
                Label("Next dose", systemImage: "pills.fill")
                    .font(.caption2.weight(.semibold))
                if let dose {
                    Text(dose.medicationName)
                        .font(.headline)
                        .lineLimit(1)
                        .privacySensitive(hideDetails)
                    Text("\(dose.petName) · \(dose.timeText)")
                        .font(.caption)
                        .lineLimit(1)
                        .privacySensitive(hideDetails)
                } else {
                    Text("No doses due today")
                        .font(.caption)
                }
            }
            .frame(maxWidth: .infinity, alignment: .leading)
            .accessibilityElement(children: .combine)
        }
    }
}

// MARK: - Widget

struct PetChainLockScreenWidget: Widget {
    let kind: String = "com.petchain.widget.lockscreen"

    var body: some WidgetConfiguration {
        StaticConfiguration(kind: kind, provider: PetChainWidgetProvider()) { entry in
            PetChainLockScreenEntryView(entry: entry)
                .containerBackground(.clear, for: .widget)
        }
        .configurationDisplayName("Today's Doses")
        .description("See your pet's next medication dose on the lock screen.")
        .supportedFamilies([.accessoryRectangular, .accessoryInline, .accessoryCircular])
    }
}
