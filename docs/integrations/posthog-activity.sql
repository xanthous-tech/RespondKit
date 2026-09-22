SELECT
    uuid, timestamp, event, distinct_id,
    left(toString(properties.$session_id), 128) AS session_id,
    left(replaceRegexpAll(coalesce(nullIf(toString(properties.$pathname), ''), path(toString(properties.$current_url)), ''), '[?#].*$', ''), 512) AS page_path,
    left(toString(properties.surface), 64) AS surface,
    left(coalesce(nullIf(toString(properties.app_version), ''), toString(properties.$app_version)), 64) AS app_version,
    left(toString(properties.error_code), 128) AS error_code,
    left(toString(properties.error_type), 128) AS error_type,
    left(toString(properties.input_type), 64) AS input_type,
    left(toString(properties.pipeline_mode), 64) AS pipeline_mode
FROM events
WHERE distinct_id = {variables.respondkit_distinct_id}
  AND length(trim({variables.respondkit_distinct_id})) > 0
  AND timestamp >= greatest(toDateTime({variables.respondkit_start_time}), toDateTime({variables.respondkit_end_time}) - INTERVAL 7 DAY)
  AND timestamp <= least(toDateTime({variables.respondkit_end_time}), now())
  AND (
    ({variables.respondkit_event_kind} = 'all' AND (not startsWith(event, '$') OR event IN ('$pageview', '$pageleave', '$screen', '$exception', '$rageclick')))
    OR ({variables.respondkit_event_kind} = 'pageviews' AND event = '$pageview')
    OR ({variables.respondkit_event_kind} = 'events' AND (not startsWith(event, '$') OR event IN ('$exception', '$rageclick')))
  )
ORDER BY timestamp DESC, uuid DESC
LIMIT least(greatest(toInt({variables.respondkit_row_limit}), 1), 101)
